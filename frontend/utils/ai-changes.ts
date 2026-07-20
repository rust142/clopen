export type GutterViewMode = 'ai' | 'git';

export interface AiChange {
	oldContent: string;
	newContent: string;
	timestamp: number;
}

const changes = new Map<string, AiChange[]>();
let aiChangeListeners: Array<() => void> = [];

// Listeners for the set of file paths that have AI changes
let aiFilesListeners: Array<(paths: Set<string>) => void> = [];

function buildAiFilesSet(): Set<string> {
	const set = new Set<string>();
	for (const [path, list] of changes.entries()) {
		if (list.length > 0) set.add(path);
	}
	return set;
}

function notifyAiFilesListeners() {
	const set = buildAiFilesSet();
	for (const fn of aiFilesListeners) fn(set);
}

export function onAiFilesChange(fn: (paths: Set<string>) => void): () => void {
	aiFilesListeners.push(fn);
	// Immediately emit current state so remounting consumers get existing data
	fn(buildAiFilesSet());
	return () => {
		aiFilesListeners = aiFilesListeners.filter((l) => l !== fn);
	};
}

// Scroll-reveal signal
let pendingReveal: { path: string; editIndex: number } | null = null;

let _gutterViewMode: GutterViewMode = 'ai';
let gutterModeListeners: Array<(mode: GutterViewMode) => void> = [];

export function getGutterViewMode(): GutterViewMode {
	return _gutterViewMode;
}

export function setGutterViewMode(mode: GutterViewMode) {
	_gutterViewMode = mode;
	for (const fn of gutterModeListeners) fn(mode);
}

export function onGutterViewModeChange(fn: (mode: GutterViewMode) => void): () => void {
	gutterModeListeners.push(fn);
	return () => {
		gutterModeListeners = gutterModeListeners.filter((l) => l !== fn);
	};
}

/** Push a change and return its edit index (position in the array). */
export function addAiChange(filePath: string, oldContent: string, newContent: string): number {
	const list = changes.get(filePath) ?? [];

	// Dedupe: skip if last entry matches exactly (handles component remounts)
	const last = list[list.length - 1];
	if (last && last.oldContent === oldContent && last.newContent === newContent) {
		return list.length - 1;
	}

	const editIndex = list.length;
	list.push({ oldContent, newContent, timestamp: Date.now() });
	changes.set(filePath, list);
	for (const fn of aiChangeListeners) fn();
	notifyAiFilesListeners();
	return editIndex;
}

export function getAiChanges(filePath: string): AiChange[] {
	return changes.get(filePath) ?? [];
}

export function clearAiChange(filePath: string) {
	changes.delete(filePath);
	notifyAiFilesListeners();
}

export function clearAllAiChanges() {
	changes.clear();
	notifyAiFilesListeners();
}

export function onAiChange(fn: () => void): () => void {
	aiChangeListeners.push(fn);
	return () => {
		aiChangeListeners = aiChangeListeners.filter((l) => l !== fn);
	};
}

let revealListeners: Array<(path: string, editIndex: number) => void> = [];

export function requestAiScrollReveal(filePath: string, editIndex: number) {
	pendingReveal = { path: filePath, editIndex };
	for (const fn of revealListeners) fn(filePath, editIndex);
}

export function onAiScrollReveal(fn: (path: string, editIndex: number) => void): () => void {
	revealListeners.push(fn);
	return () => {
		revealListeners = revealListeners.filter((l) => l !== fn);
	};
}

/** Consume if path matches. Returns editIndex to reveal, or -1 if no match. */
export function consumeAiScrollReveal(filePath: string): number {
	if (pendingReveal && pendingReveal.path === filePath) {
		const idx = pendingReveal.editIndex;
		pendingReveal = null;
		return idx;
	}
	return -1;
}

export function getFilesWithAiChanges(): string[] {
	const paths: string[] = [];
	for (const [path, list] of changes.entries()) {
		if (list.length > 0) paths.push(path);
	}
	return paths;
}
