/**
 * OpenRouter free-model daily usage.
 *
 * Shows remaining free requests for the current UTC day, weekly budget
 * remaining, and spend in the footer (status id "fusage") and via the
 * /fusage command. Refreshes on session start, after each turn,
 * every minute, and on /fusage.
 *
 * Token resolution: OPENROUTER_API_KEY env var, else the OAuth access
 * token pi stores in ~/.pi/agent/auth.json (verified to work for
 * GET https://openrouter.ai/api/v1/key).
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "fusage";

function getToken(): string | undefined {
	if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
	try {
		const auth = JSON.parse(readFileSync(join(homedir(), ".pi", "agent", "auth.json"), "utf8"));
		const entry = auth?.openrouter;
		if (typeof entry === "string") return entry;
		if (typeof entry?.access === "string" && entry.access) return entry.access;
		if (typeof entry?.key === "string") return entry.key;
	} catch {
		// unreadable auth store — fall through
	}
	return undefined;
}

interface Budget {
	limit_usd: number;
	spend_usd: number;
	remaining_usd: number;
	reset_interval: string | null;
	resets_at: string | null;
}

interface KeyInfo {
	free: { used: number; limit: number; remaining: number };
	usageDaily: number;
	usageWeekly: number;
	usageMonthly: number;
	budget: Budget | null;
	budgets: (Budget & { scope: string })[];
}

async function fetchKeyInfo(): Promise<KeyInfo> {
	const token = getToken();
	if (!token) throw new Error("No OpenRouter token (set OPENROUTER_API_KEY)");
	const res = await fetch("https://openrouter.ai/api/v1/key", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error(`OpenRouter /key returned HTTP ${res.status}`);
	const { data } = (await res.json()) as {
		data?: {
			free_model_daily_requests?: KeyInfo["free"];
			usage_daily?: number;
			usage_weekly?: number;
			usage_monthly?: number;
			effective_budget?: Budget | null;
			budgets?: (Budget & { scope: string })[];
		};
	};
	const f = data?.free_model_daily_requests;
	if (!f) throw new Error("No free_model_daily_requests in /key response");
	return {
		free: f,
		usageDaily: data?.usage_daily ?? 0,
		usageWeekly: data?.usage_weekly ?? 0,
		usageMonthly: data?.usage_monthly ?? 0,
		budget: data?.effective_budget ?? null,
		budgets: data?.budgets ?? [],
	};
}

function resetCountdown(): { text: string; iso: string } {
	const now = new Date();
	const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
	const ms = reset.getTime() - now.getTime();
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	return { text: `${h}h${String(m).padStart(2, "0")}m`, iso: reset.toISOString() };
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let sessionAlive = true;
	const refresh = async (ctx: any) => {
		try {
			const info = await fetchKeyInfo();
			const { free: f } = info;
			const { text } = resetCountdown();
			const theme = ctx.ui.theme;
			const lowFree = f.remaining <= Math.max(5, Math.floor(f.limit * 0.1));
			const lowBudget = info.budget != null && info.budget.limit_usd > 0 && info.budget.remaining_usd / info.budget.limit_usd <= 0.2;
			const freeText = lowFree ? theme.fg("warning", `free ${f.remaining}/${f.limit}`) : theme.fg("dim", `free ${f.remaining}/${f.limit}`);
			let status = `${freeText} ${theme.fg("dim", `· ${text}`)}`;
			if (info.budget) {
				const b = `$${info.budget.remaining_usd.toFixed(2)} wk`;
				status += ` ${theme.fg(lowBudget ? "warning" : "dim", `· ${b}`)}`;
			}
			ctx.ui.setStatus(STATUS_ID, status);
		} catch (err) {
			// ctx may be stale (session replaced/reloaded while fetch was in
			// flight) — never let this reject into an unhandled exception.
			console.error(`fusage: ${(err as Error).message}`);
			try {
				ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("error", "free ?"));
			} catch {
				// stale ctx — nothing to update
			}
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		await refresh(ctx);
		if (timer) clearInterval(timer);
		sessionAlive = true;
		timer = setInterval(() => {
			if (!sessionAlive) return;
			refresh(ctx).catch(() => {});
		}, 60_000);
		timer.unref?.();
	});

	// Old ctx objects are invalid after session replacement/reload; the
	// interval above must not outlive the session or it crashes pi.
	pi.on("session_shutdown", async () => {
		sessionAlive = false;
		if (timer) clearInterval(timer);
		timer = undefined;
	});
	pi.on("turn_end", (_event, ctx) => {
		refresh(ctx).catch(() => {});
	});

	pi.registerCommand("fusage", {
		description: "Show OpenRouter free-model daily usage and time until UTC reset",
		handler: async (_args, ctx) => {
			try {
				const info = await fetchKeyInfo();
				const { free: f } = info;
				const { text, iso } = resetCountdown();
				const lines = [
					`Free requests today (UTC): ${f.remaining} remaining of ${f.limit} (used ${f.used})`,
					`Resets at 00:00 UTC in ${text} (${iso})`,
					`Spend: today $${info.usageDaily.toFixed(4)} · week $${info.usageWeekly.toFixed(4)} · month $${info.usageMonthly.toFixed(4)}`,
				];
				for (const b of info.budgets) {
					const resets = b.resets_at ? new Date(b.resets_at).toISOString().slice(0, 10) : "?";
					const interval = b.reset_interval ?? "?";
					lines.push(`Budget [${b.scope}, ${interval}]: $${b.remaining_usd.toFixed(4)} of $${b.limit_usd} remaining (spent $${b.spend_usd.toFixed(4)}, resets ${resets})`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				await refresh(ctx);
			} catch (err) {
				ctx.ui.notify(`fusage: ${(err as Error).message}`, "error");
			}
		},
	});
}
