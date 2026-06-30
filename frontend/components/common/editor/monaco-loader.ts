import loader from '@monaco-editor/loader';
import type * as Monaco from 'monaco-editor';
import type { editor as MonacoEditor, Uri } from 'monaco-editor';
import { dbClientStore } from '$frontend/stores/features/db-client.svelte';

let monacoPromise: Promise<typeof Monaco> | null = null;
let modelCounter = 0;

export function initMonaco(): Promise<typeof Monaco> {
	if (!monacoPromise) {
		monacoPromise = loader.init().then((monaco) => {
			configureCompilerOptions(monaco);
			configureDiagnostics(monaco);
			registerSqlAutocomplete(monaco);
			return monaco;
		});
	}
	return monacoPromise;
}

const DEFAULT_FILENAME_BY_LANGUAGE: Record<string, string> = {
	typescript: 'file.ts',
	javascript: 'file.js',
	json: 'file.json',
	html: 'file.html',
	css: 'file.css',
	scss: 'file.scss',
	less: 'file.less',
	python: 'file.py',
	markdown: 'file.md',
	yaml: 'file.yaml',
	xml: 'file.xml',
};

function synthesizeFilename(language: string): string {
	return DEFAULT_FILENAME_BY_LANGUAGE[language] ?? 'file.txt';
}

function extractFilename(path: string): string {
	const name = path.split(/[\\/]/).pop();
	return name && name.length > 0 ? name : 'file';
}

export function createModelUri(monaco: typeof Monaco, path: string | undefined, language: string): Uri {
	const filename = path ? extractFilename(path) : synthesizeFilename(language);
	return monaco.Uri.parse(`inmemory://clopen/${++modelCounter}/${filename}`);
}

export function createModel(
	monaco: typeof Monaco,
	value: string,
	language: string,
	path?: string
): MonacoEditor.ITextModel {
	return monaco.editor.createModel(value, language, createModelUri(monaco, path, language));
}

// ============================================================
// Per-path model + view-state registry
// ============================================================
//
// The Files editor remounts a fresh <MonacoCodeEditor> for every file (and on
// theme change). A brand-new ITextModel each time means the undo/redo stack and
// scroll/cursor/fold state are lost the moment you preview another file. To keep
// them, we cache ONE model per file path (each model owns its own undo stack)
// plus its last view state, and reuse them across remounts. Bounded by LRU.

const MAX_CACHED_MODELS = 24;
const modelRegistry = new Map<string, MonacoEditor.ITextModel>();
const viewStateRegistry = new Map<string, MonacoEditor.ICodeEditorViewState>();

function stableModelUri(monaco: typeof Monaco, path: string): Uri {
	// Single encoded segment → a stable, collision-free URI per path.
	return monaco.Uri.parse(`inmemory://clopen-file/${encodeURIComponent(path)}`);
}

function touchModel(path: string, model: MonacoEditor.ITextModel): void {
	modelRegistry.delete(path);
	modelRegistry.set(path, model);
}

function evictIfNeeded(): void {
	while (modelRegistry.size >= MAX_CACHED_MODELS) {
		const oldestPath = modelRegistry.keys().next().value as string | undefined;
		if (oldestPath === undefined) break;
		const stale = modelRegistry.get(oldestPath);
		modelRegistry.delete(oldestPath);
		viewStateRegistry.delete(oldestPath);
		if (stale && !stale.isDisposed()) stale.dispose();
	}
}

/**
 * Get a cached model for `path`, or create one. Reuse preserves the undo stack.
 * IMPORTANT (content-loss safety): a cached model is only reused when its content
 * matches the requested `value`. If they diverge (external reload, etc.), the
 * stale model is discarded and a fresh one created — never silently overriding
 * the caller's content. Paths-less editors are never cached.
 */
export function getOrCreateCachedModel(
	monaco: typeof Monaco,
	value: string,
	language: string,
	path?: string
): { model: MonacoEditor.ITextModel; cached: boolean } {
	if (!path) {
		return { model: createModel(monaco, value, language, path), cached: false };
	}

	const existing = modelRegistry.get(path);
	if (existing && !existing.isDisposed()) {
		if (existing.getValue() === value) {
			touchModel(path, existing);
			return { model: existing, cached: true };
		}
		// Content diverged — replace to avoid showing stale content.
		modelRegistry.delete(path);
		viewStateRegistry.delete(path);
		existing.dispose();
	}

	evictIfNeeded();

	const uri = stableModelUri(monaco, path);
	const dup = monaco.editor.getModel(uri);
	if (dup) dup.dispose();
	const model = monaco.editor.createModel(value, language, uri);
	modelRegistry.set(path, model);
	return { model, cached: true };
}

/** Persist a path's editor view state (scroll, cursor, selection, folds). */
export function saveModelViewState(
	path: string | undefined,
	state: MonacoEditor.ICodeEditorViewState | null
): void {
	if (!path || !state) return;
	viewStateRegistry.set(path, state);
}

/** Retrieve a path's last view state, if any. */
export function getModelViewState(
	path: string | undefined
): MonacoEditor.ICodeEditorViewState | undefined {
	return path ? viewStateRegistry.get(path) : undefined;
}

function configureCompilerOptions(monaco: typeof Monaco) {
	const ts = monaco.languages.typescript;
	const compilerOptions = {
		target: ts.ScriptTarget.Latest,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.NodeJs,
		jsx: ts.JsxEmit.Preserve,
		allowJs: true,
		allowNonTsExtensions: true,
		esModuleInterop: true,
		allowSyntheticDefaultImports: true,
		noEmit: true,
	};
	ts.typescriptDefaults.setCompilerOptions(compilerOptions);
	ts.javascriptDefaults.setCompilerOptions(compilerOptions);
}

function configureDiagnostics(monaco: typeof Monaco) {
	const tsDiagnostics = {
		noSemanticValidation: true,
		noSyntaxValidation: false,
		noSuggestionDiagnostics: true,
	};
	monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(tsDiagnostics);
	monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(tsDiagnostics);

	monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
	monaco.languages.css.cssDefaults.setOptions({ validate: false });
	monaco.languages.css.scssDefaults.setOptions({ validate: false });
	monaco.languages.css.lessDefaults.setOptions({ validate: false });
}

let sqlProviderDisposable: Monaco.IDisposable | null = null;

function registerSqlAutocomplete(monaco: typeof Monaco) {
	if (sqlProviderDisposable) {
		sqlProviderDisposable.dispose();
	}

	sqlProviderDisposable = monaco.languages.registerCompletionItemProvider('sql', {
		triggerCharacters: ['.', ' '],
		provideCompletionItems: (model, position) => {
			const word = model.getWordUntilPosition(position);
			const range = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: word.startColumn,
				endColumn: word.endColumn
			};

			const suggestions: Monaco.languages.CompletionItem[] = [];

			// 1. SQL Keywords
			const SQL_KEYWORDS = [
				'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'LIMIT', 'OFFSET',
				'ORDER BY', 'GROUP BY', 'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN',
				'INNER JOIN', 'ON', 'AS', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET',
				'DELETE FROM', 'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE',
				'IN', 'IS NULL', 'IS NOT NULL', 'LIKE', 'ILIKE', 'EXISTS'
			];

			for (const kw of SQL_KEYWORDS) {
				suggestions.push({
					label: kw,
					kind: monaco.languages.CompletionItemKind.Keyword,
					insertText: kw,
					range
				} as Monaco.languages.CompletionItem);
			}

			// 2. Tables and Views from current connection schema
			const connId = dbClientStore.activeConnectionId;
			if (connId) {
				const schemaNodes = dbClientStore.schema[connId] ?? [];
				for (const node of schemaNodes) {
					if (node.type === 'table' || node.type === 'view') {
						suggestions.push({
							label: node.name,
							kind: node.type === 'view'
								? monaco.languages.CompletionItemKind.Interface
								: monaco.languages.CompletionItemKind.Class,
							insertText: node.name,
							detail: node.type.toUpperCase(),
							range
						} as Monaco.languages.CompletionItem);
					}
				}

				// 3. Columns from cached object details belonging to this connection
				const details = dbClientStore.objectDetails;
				const columnsSeen = new Set<string>();
				for (const [key, value] of Object.entries(details)) {
					if (key.startsWith(`${connId}::`) && value?.columns) {
						for (const col of value.columns) {
							if (!columnsSeen.has(col.name)) {
								columnsSeen.add(col.name);
								suggestions.push({
									label: col.name,
									kind: monaco.languages.CompletionItemKind.Field,
									insertText: col.name,
									detail: `COLUMN (${col.type})`,
									range
								} as Monaco.languages.CompletionItem);
							}
						}
					}
				}
			}

			return { suggestions };
		}
	});
}
