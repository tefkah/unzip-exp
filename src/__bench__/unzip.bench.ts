import AdmZip from "adm-zip";
import extractZip from "extract-zip";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import util from "node:util";
import { bench } from "vitest";
import yauzl from "yauzl";
import { extract } from "../index.js";

const EPUB_PATH = new URL("./Moby.epub", import.meta.url).pathname;

const OUTPUT_BASE = join(process.cwd(), "__bench__", "output");

function promisify<Arg, Options, Return>(
	api: (
		arg: Arg,
		options: Options,
		callback: (err: Error | null, result: Return) => void,
	) => void,
): (arg: Arg, options: Options) => Promise<Return> {
	return (arg: Arg, options: Options) =>
		new Promise((resolve, reject) => {
			api(arg, options, (err, response) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(response);
			});
		});
}

async function cleanupOutput(testName: string) {
	const outputDir = join(OUTPUT_BASE, testName);
	await rm(outputDir, { recursive: true, force: true });
}

async function setupOutput(testName: string) {
	const outputDir = join(OUTPUT_BASE, testName);
	await mkdir(outputDir, { recursive: true });
	return outputDir;
}
// bench(
// 	"unzipper (streaming)",
// 	async () => {
// 		try {
// 			const outputDir = await setupOutput("unzipper");
// 			await pipeline(
// 				createReadStream(EPUB_PATH),
// 				unzipper.Extract({ path: outputDir }),
// 			);
// 			await cleanupOutput("unzipper");
// 		} catch (error) {
// 			console.error(error);
// 		}
// 		console.log("unzipper done");
// 	},
// 	{ iterations: 1, warmupIterations: 0 },
// );

bench(
	"yauzl (streaming)",
	async () => {
		const outputDir = await setupOutput("yauzl");

		const zipfile = await promisify<
			string,
			{ lazyEntries: boolean },
			yauzl.ZipFile
		>(yauzl.open.bind(yauzl))(EPUB_PATH, { lazyEntries: true });

		const { promise, resolve } = Promise.withResolvers<void>();

		zipfile.on("end", () => {
			resolve();
		});
		const openReadStream = util.promisify(zipfile.openReadStream.bind(zipfile));
		zipfile.readEntry();
		zipfile.on("entry", async (entry) => {
			if (entry.fileName.endsWith("/")) {
				// Directory file names end with '/'.
				// Note that entries for directories themselves are optional.
				// An entry's fileName implicitly requires its parent directories to exist.
				zipfile.readEntry();
			} else {
				const writePath = join(outputDir, entry.fileName);
				const readStream = await openReadStream(entry);
				await mkdir(dirname(writePath), { recursive: true });
				// file entry
				await new Promise<void>((resolvePipe) => {
					const writePath = join(outputDir, entry.fileName);
					const writeStream = createWriteStream(writePath);
					writeStream.on("finish", () => {
						resolvePipe();
					});
					readStream.pipe(writeStream);
				}).finally(() => {
					zipfile.readEntry();
				});
			}
		});
		await promise;

		await cleanupOutput("yauzl");
	},
	{ iterations: 1, warmupIterations: 0 },
);

bench(
	"our implementation (streaming)",
	async () => {
		const outputDir = await setupOutput("our-impl");
		await extract(EPUB_PATH, outputDir);
		await cleanupOutput("our-impl");
	},
	{ iterations: 1, warmupIterations: 0 },
);

bench(
	"adm-zip (buffer)",
	async () => {
		const outputDir = await setupOutput("adm-zip");
		const zip = new AdmZip(EPUB_PATH);
		zip.extractAllTo(outputDir, true);
		await cleanupOutput("adm-zip");
	},
	{ iterations: 1, warmupIterations: 0 },
);

bench(
	"extract-zip (buffer)",
	async () => {
		const outputDir = await setupOutput("extract-zip");
		await extractZip(EPUB_PATH, { dir: outputDir });
		await cleanupOutput("extract-zip");
	},
	{ iterations: 1, warmupIterations: 0 },
);
