import { readFile } from "node:fs/promises";
import process from "node:process";

const DEFAULT_HAR = "research/filtered_domains_08-02-2026-18-20-40.har";
const API_HOST = "looplus-api-staging.loopluscooter.com";
const JWT_PATTERN = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const harPath = process.argv[2] ?? DEFAULT_HAR;
const har = JSON.parse(await readFile(harPath, "utf8"));

function normalizePath(rawUrl) {
	const url = new URL(rawUrl);
	const parts = url.pathname.split("/").map((part, index, all) => {
		if (JWT_PATTERN.test(part)) return "{token}";
		if (/^\d+$/.test(part)) {
			const previous = all[index - 1];
			if (previous === "get-possible-ride-plan") return "{scooterId}";
			if (previous === "get-by-scooter-id-for-users") return "{scooterId}";
			if (previous === "find-by-location-id-and-key-for-user") return "{locationId}";
			return "{id}";
		}
		return part;
	});

	return parts.join("/");
}

function parseJsonContent(content) {
	if (!content?.text) return null;

	try {
		const text = content.encoding === "base64" ? Buffer.from(content.text, "base64").toString("utf8") : content.text;
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function shapeOf(value) {
	if (Array.isArray(value)) {
		const first = value[0];
		return first && typeof first === "object" ? `array<${Object.keys(first).slice(0, 8).join(", ")}${Object.keys(first).length > 8 ? ", …" : ""}>` : "array";
	}

	if (value && typeof value === "object") {
		const keys = Object.keys(value);
		return `object<${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", …" : ""}>`;
	}

	return value === null ? "empty" : typeof value;
}

function requestFields(entry) {
	const postData = entry.request.postData;
	if (!postData) return [];

	try {
		const parsed = JSON.parse(postData.text ?? "");
		if (Array.isArray(parsed)) return Object.keys(parsed[0] ?? {});
		if (parsed && typeof parsed === "object") return Object.keys(parsed);
	} catch {
		// Multipart bodies are represented as named params by some HAR exporters.
	}

	return (postData.params ?? []).map(({ name }) => name).filter(name => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,80}$/.test(name));
}

const rows = new Map();

for (const entry of har.log.entries) {
	let url;
	try {
		url = new URL(entry.request.url);
	} catch {
		continue;
	}
	if (url.host !== API_HOST) continue;

	const path = normalizePath(entry.request.url);
	const key = `${entry.request.method} ${path}`;
	const row = rows.get(key) ?? {
		method: entry.request.method,
		path,
		count: 0,
		statuses: new Set(),
		query: new Set(),
		requestFields: new Set(),
		responseShape: "empty"
	};

	row.count += 1;
	row.statuses.add(entry.response.status);
	for (const { name } of entry.request.queryString ?? []) row.query.add(name);
	for (const name of requestFields(entry)) row.requestFields.add(name);

	const response = parseJsonContent(entry.response.content);
	if (response !== null) row.responseShape = shapeOf(response);
	rows.set(key, row);
}

const sortedRows = [...rows.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

console.log("| Method | Observed path | Count | Status | Query names | Request fields | Response shape |");
console.log("| --- | --- | ---: | --- | --- | --- | --- |");

for (const row of sortedRows) {
	const cell = values => [...values].sort().join(", ") || "-";
	console.log(`| ${row.method} | \`${row.path}\` | ${row.count} | ${cell(row.statuses)} | ${cell(row.query)} | ${cell(row.requestFields)} | ${row.responseShape} |`);
}
