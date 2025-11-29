import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extract, extractZipStream } from "../stream-extractor.js";

const TEST_ZIP_PATH = join(process.cwd(), "assets", "Iron Council.epub");
const TEST_OUTPUT_DIR = join(process.cwd(), "src", "__tests__", "__output__");
const REFERENCE_OUTPUT_DIR = join(
	process.cwd(),
	"src",
	"__tests__",
	"__reference__",
);

describe("extract", () => {
	beforeEach(async () => {
		await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
		await rm(REFERENCE_OUTPUT_DIR, { recursive: true, force: true });
	});

	afterEach(async () => {
		await rm(TEST_OUTPUT_DIR, { recursive: true, force: true });
		await rm(REFERENCE_OUTPUT_DIR, { recursive: true, force: true });
	});

	it("should extract all files from zip", async () => {
		await extract(TEST_ZIP_PATH, TEST_OUTPUT_DIR);

		const files = await getAllFiles(TEST_OUTPUT_DIR);
		expect(files.length).toBeGreaterThan(0);
	});

	it("should match reference implementation output", async () => {
		const referenceZip = new AdmZip(TEST_ZIP_PATH);
		referenceZip.extractAllTo(REFERENCE_OUTPUT_DIR, true);

		await extract(TEST_ZIP_PATH, TEST_OUTPUT_DIR);

		const ourFiles = (await getAllFiles(TEST_OUTPUT_DIR)).sort();
		const referenceFiles = (await getAllFiles(REFERENCE_OUTPUT_DIR)).sort();

		expect(ourFiles.length).toBe(referenceFiles.length);

		const ourRelative = ourFiles.map((f) =>
			f.replace(TEST_OUTPUT_DIR + "/", ""),
		);
		const refRelative = referenceFiles.map((f) =>
			f.replace(REFERENCE_OUTPUT_DIR + "/", ""),
		);

		expect(ourRelative).toEqual(refRelative);
	});

	it("should extract files with correct content", async () => {
		const referenceZip = new AdmZip(TEST_ZIP_PATH);
		referenceZip.extractAllTo(REFERENCE_OUTPUT_DIR, true);

		await extract(TEST_ZIP_PATH, TEST_OUTPUT_DIR);

		const referenceFiles = await getAllFiles(REFERENCE_OUTPUT_DIR);

		for (const refFile of referenceFiles) {
			const relativePath = refFile.replace(REFERENCE_OUTPUT_DIR + "/", "");
			const ourFile = join(TEST_OUTPUT_DIR, relativePath);

			const refStats = await stat(refFile);
			const ourStats = await stat(ourFile);

			if (!refStats.isDirectory()) {
				const refContent = await readFile(refFile);
				const ourContent = await readFile(ourFile);

				expect(ourContent.length).toBe(refContent.length);
				expect(ourContent.equals(refContent)).toBe(true);
			}
		}
	});

	it("should create correct directory structure", async () => {
		await extract(TEST_ZIP_PATH, TEST_OUTPUT_DIR);

		const dirs = await getAllDirectories(TEST_OUTPUT_DIR);
		expect(dirs.length).toBeGreaterThan(0);

		for (const dir of dirs) {
			const stats = await stat(dir);
			expect(stats.isDirectory()).toBe(true);
		}
	});

	it("should handle custom concurrency", async () => {
		await extractZipStream(TEST_ZIP_PATH, {
			outputPath: TEST_OUTPUT_DIR,
			concurrency: 4,
		});

		const files = await getAllFiles(TEST_OUTPUT_DIR);
		expect(files.length).toBeGreaterThan(0);
	});

	it("should handle concurrency of 1 (sequential)", async () => {
		await extractZipStream(TEST_ZIP_PATH, {
			outputPath: TEST_OUTPUT_DIR,
			concurrency: 1,
		});

		const files = await getAllFiles(TEST_OUTPUT_DIR);
		expect(files.length).toBeGreaterThan(0);
	});

	it("should extract files with various compression methods", async () => {
		await extract(TEST_ZIP_PATH, TEST_OUTPUT_DIR);

		const files = await getAllFiles(TEST_OUTPUT_DIR);
		expect(files.length).toBeGreaterThan(0);

		for (const file of files) {
			const stats = await stat(file);
			if (!stats.isDirectory()) {
				const content = await readFile(file);
				expect(content).toBeDefined();
			}
		}
	});

	it("should preserve file sizes", async () => {
		const referenceZip = new AdmZip(TEST_ZIP_PATH);
		referenceZip.extractAllTo(REFERENCE_OUTPUT_DIR, true);

		await extract(TEST_ZIP_PATH, TEST_OUTPUT_DIR);

		const referenceFiles = await getAllFiles(REFERENCE_OUTPUT_DIR);

		for (const refFile of referenceFiles) {
			const relativePath = refFile.replace(REFERENCE_OUTPUT_DIR + "/", "");
			const ourFile = join(TEST_OUTPUT_DIR, relativePath);

			const refStats = await stat(refFile);
			const ourStats = await stat(ourFile);

			if (!refStats.isDirectory()) {
				expect(ourStats.size).toBe(refStats.size);
			}
		}
	});
});

async function getAllFiles(dir: string): Promise<string[]> {
	const files: string[] = [];

	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				const subFiles = await getAllFiles(fullPath);
				files.push(...subFiles);
			} else {
				files.push(fullPath);
			}
		}
	} catch {
		return [];
	}

	return files;
}

async function getAllDirectories(dir: string): Promise<string[]> {
	const dirs: string[] = [];

	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				dirs.push(fullPath);
				const subDirs = await getAllDirectories(fullPath);
				dirs.push(...subDirs);
			}
		}
	} catch {
		return [];
	}

	return dirs;
}
