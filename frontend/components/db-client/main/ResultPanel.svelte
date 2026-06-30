<script lang="ts">
	import Icon from '$frontend/components/common/display/Icon.svelte';
	import NullValue from '../shared/NullValue.svelte';
	import type { DbClientQueryResult } from '$shared/types/db-client';

	interface Props {
		result: DbClientQueryResult | null;
		error: string | null;
		running: boolean;
	}

	const { result, error, running }: Props = $props();

	// When backend returns multiple result sets, show them as tabs
	const resultSets = $derived(
		result?.results && result.results.length > 1
			? result.results
			: result
				? [result]
				: []
	);

	let activeResultIdx = $state(0);

	$effect(() => {
		// Reset active tab when result changes
		void result;
		activeResultIdx = 0;
	});

	const activeResult = $derived(resultSets[activeResultIdx] ?? null);

	function isNullish(v: unknown): boolean {
		return v === null || v === undefined;
	}

	function fmt(value: unknown): string {
		if (isNullish(value)) return 'NULL';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	function display(value: unknown): string {
		if (isNullish(value)) return '';
		if (typeof value === 'object') return JSON.stringify(value);
		return String(value);
	}

	function escapeCsv(s: string): string {
		if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
		return s;
	}

	function download(content: string, filename: string, mime: string): void {
		const blob = new Blob([content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportCsv(): void {
		if (!activeResult) return;
		const cols = activeResult.columns.map((c) => c.name);
		const header = cols.map(escapeCsv).join(',');
		const lines = activeResult.rows.map((r) =>
			cols.map((c) => escapeCsv(fmt(r[c]))).join(',')
		);
		download([header, ...lines].join('\n'), 'query-result.csv', 'text/csv');
	}

	function exportJson(): void {
		if (!activeResult) return;
		download(JSON.stringify(activeResult.rows, null, 2), 'query-result.json', 'application/json');
	}

	function exportMarkdown(): void {
		if (!activeResult) return;
		const cols = activeResult.columns.map((c) => c.name);
		const header = `| ${cols.join(' | ')} |`;
		const sep = `| ${cols.map(() => '---').join(' | ')} |`;
		const lines = activeResult.rows.map((r) => `| ${cols.map((c) => fmt(r[c]).replace(/\|/g, '\\|')).join(' | ')} |`);
		download([header, sep, ...lines].join('\n'), 'query-result.md', 'text/markdown');
	}

	async function copyCell(value: unknown): Promise<void> {
		await navigator.clipboard.writeText(fmt(value));
	}
</script>

<div class="flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
	<div class="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 text-sm shrink-0">
		<div class="flex items-center gap-3 text-slate-600 dark:text-slate-400">
			{#if running}
				<span class="flex items-center gap-1">
					<Icon name="lucide:loader" class="w-3 h-3 animate-spin" /> running…
				</span>
			{:else if error}
				<span class="text-red-600 dark:text-red-400">error</span>
			{:else if activeResult}
				<span>{activeResult.rowCount} rows</span>
				{#if activeResult.affectedRows !== null}
					<span>· {activeResult.affectedRows} affected</span>
				{/if}
				<span>· {result?.durationMs} ms total</span>
			{:else}
				<span class="text-slate-400">No result yet</span>
			{/if}
		</div>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
				onclick={exportCsv}
				disabled={!activeResult || activeResult.rows.length === 0}
				title="Export CSV"
			>CSV</button>
			<button
				type="button"
				class="px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
				onclick={exportJson}
				disabled={!activeResult || activeResult.rows.length === 0}
				title="Export JSON"
			>JSON</button>
			<button
				type="button"
				class="px-2 py-0.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
				onclick={exportMarkdown}
				disabled={!activeResult || activeResult.rows.length === 0}
				title="Export Markdown"
			>MD</button>
		</div>
	</div>

	<!-- Multi-result tabs (only when more than 1 result set) -->
	{#if resultSets.length > 1}
		<div class="flex items-center gap-0.5 px-2 pt-1.5 border-b border-slate-200 dark:border-slate-800 shrink-0 overflow-x-auto">
			{#each resultSets as res, i (i)}
				<button
					type="button"
					class="flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-t border transition-colors shrink-0 cursor-pointer {activeResultIdx === i
						? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 border-b-white dark:border-b-slate-900 text-violet-600 dark:text-violet-400'
						: 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}"
					onclick={() => activeResultIdx = i}
				>
					<Icon name="lucide:table" class="w-3 h-3" />
					Result {i + 1}
					<span class="text-[10px] opacity-70">({res.rowCount} rows)</span>
				</button>
			{/each}
		</div>
	{/if}

	<div class="flex-1 min-h-0 overflow-auto">
		{#if error}
			<pre class="p-3 text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">{error}</pre>
		{:else if activeResult && activeResult.rows.length > 0}
			<table class="w-full text-sm border-collapse bg-slate-50 dark:bg-slate-800/50">
				<thead class="sticky top-0 bg-slate-200 dark:bg-slate-800 z-10">
					<tr>
						<th class="px-2 py-1 text-left font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800 w-10">#</th>
						{#each activeResult.columns as col (col.name)}
							<th class="px-2 py-1 text-left font-semibold text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-800">
								<div class="flex flex-col">
									<span>{col.name}</span>
									{#if col.type}
										<span class="text-[10px] text-slate-400">{col.type}</span>
									{/if}
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each activeResult.rows as row, i (i)}
						<tr class="hover:bg-slate-100 dark:hover:bg-slate-800/60">
							<td class="px-2 py-1 text-slate-400 border-b border-slate-100 dark:border-slate-800">{i + 1}</td>
							{#each activeResult.columns as col (col.name)}
								<td
									class="px-2 py-1 border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer max-w-[400px] truncate"
									title={fmt(row[col.name])}
									ondblclick={() => copyCell(row[col.name])}
								>
									{#if isNullish(row[col.name])}
										<NullValue />
									{:else}
										{display(row[col.name])}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if activeResult}
			<div class="p-4 text-sm text-slate-400">Empty result set.</div>
		{/if}
	</div>
</div>

