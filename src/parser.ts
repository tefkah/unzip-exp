import {
	CENTRAL_DIRECTORY_HEADER_SIZE,
	CENTRAL_DIRECTORY_SIGNATURE,
	END_OF_CENTRAL_DIRECTORY_SIGNATURE,
	END_OF_CENTRAL_DIRECTORY_SIZE,
	ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE,
} from "./constants.js";
import type { ZipCentralDirectory, ZipEntry } from "./types.js";

const ZIP64_MAGIC = 0xffffffff;
const ZIP64_MAGIC_SHORT = 0xffff;

export function parseEndOfCentralDirectory(buffer: Buffer): {
	centralDirectoryOffset: number;
	centralDirectorySize: number;
	entryCount: number;
	comment: string;
} {
	const signature = buffer.readUInt32LE(0);
	if (signature !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
		throw new Error("Invalid End of Central Directory signature");
	}

	const entryCount = buffer.readUInt16LE(10);
	const centralDirectorySize = buffer.readUInt32LE(12);
	const centralDirectoryOffset = buffer.readUInt32LE(16);
	const commentLength = buffer.readUInt16LE(20);

	// ensure comment doesn't exceed buffer bounds
	const commentEnd = Math.min(22 + commentLength, buffer.length);
	const comment = buffer.toString("utf-8", 22, commentEnd);

	// check for zip64 eocd locator before this eocd
	if (buffer.length >= 20) {
		const locatorStart = -(END_OF_CENTRAL_DIRECTORY_SIZE + commentLength + 20);
		if (
			locatorStart + buffer.length >= 0 &&
			buffer.readUInt32LE(locatorStart + buffer.length) ===
				ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
		) {
			// read zip64 eocd offset from locator
			const _zip64EocdOffset = Number(
				buffer.readBigUInt64LE(locatorStart + buffer.length + 8),
			);

			// note: in a real implementation, we'd need to read the zip64 eocd from the file
			// for now, we'll just check if the values indicate zip64
			if (
				entryCount === ZIP64_MAGIC_SHORT ||
				centralDirectorySize === ZIP64_MAGIC ||
				centralDirectoryOffset === ZIP64_MAGIC
			) {
				throw new Error(
					"ZIP64 format detected but full ZIP64 support requires additional file reads",
				);
			}
		}
	}

	return {
		centralDirectoryOffset,
		centralDirectorySize,
		entryCount,
		comment,
	};
}

export function parseCentralDirectory(
	buffer: Buffer,
	entryCount: number,
	comment: string,
): ZipCentralDirectory {
	const entries: ZipEntry[] = [];
	let offset = 0;

	for (let i = 0; i < entryCount; i++) {
		const signature = buffer.readUInt32LE(offset);
		if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
			throw new Error(
				`Invalid Central Directory signature at offset ${offset}`,
			);
		}

		const _versionMadeBy = buffer.readUInt16LE(offset + 4);
		const flags = buffer.readUInt16LE(offset + 8);
		const compressionMethod = buffer.readUInt16LE(offset + 10);
		const lastModTime = buffer.readUInt16LE(offset + 12);
		const lastModDate = buffer.readUInt16LE(offset + 14);
		const crc32 = buffer.readUInt32LE(offset + 16);
		let compressedSize = buffer.readUInt32LE(offset + 20);
		let uncompressedSize = buffer.readUInt32LE(offset + 24);
		const filenameLength = buffer.readUInt16LE(offset + 28);
		const extraFieldLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		let localHeaderOffset = buffer.readUInt32LE(offset + 42);

		const filenameStart = offset + CENTRAL_DIRECTORY_HEADER_SIZE;
		const extraFieldStart = filenameStart + filenameLength;

		// check utf-8 flag
		const isUtf8 = (flags & 0x800) !== 0;
		const filename = buffer.toString(
			isUtf8 ? "utf-8" : "latin1",
			filenameStart,
			filenameStart + filenameLength,
		);

		// parse zip64 extra field if needed
		if (
			compressedSize === ZIP64_MAGIC ||
			uncompressedSize === ZIP64_MAGIC ||
			localHeaderOffset === ZIP64_MAGIC
		) {
			const zip64Data = parseZip64ExtraField(
				buffer,
				extraFieldStart,
				extraFieldLength,
				uncompressedSize === ZIP64_MAGIC,
				compressedSize === ZIP64_MAGIC,
				localHeaderOffset === ZIP64_MAGIC,
			);

			if (zip64Data.uncompressedSize !== undefined) {
				uncompressedSize = zip64Data.uncompressedSize;
			}
			if (zip64Data.compressedSize !== undefined) {
				compressedSize = zip64Data.compressedSize;
			}
			if (zip64Data.localHeaderOffset !== undefined) {
				localHeaderOffset = zip64Data.localHeaderOffset;
			}
		}

		const isDirectory = filename.endsWith("/");
		const lastModified = dosDateTimeToDate(lastModDate, lastModTime);

		entries.push({
			filename,
			compressedSize,
			uncompressedSize,
			compressionMethod,
			crc32,
			lastModified,
			localHeaderOffset,
			isDirectory,
		});

		offset +=
			CENTRAL_DIRECTORY_HEADER_SIZE +
			filenameLength +
			extraFieldLength +
			commentLength;
	}

	return { entries, comment };
}

function parseZip64ExtraField(
	buffer: Buffer,
	extraFieldStart: number,
	extraFieldLength: number,
	needUncompressed: boolean,
	needCompressed: boolean,
	needOffset: boolean,
): {
	uncompressedSize?: number;
	compressedSize?: number;
	localHeaderOffset?: number;
} {
	let offset = extraFieldStart;
	const extraFieldEnd = extraFieldStart + extraFieldLength;

	while (offset + 4 <= extraFieldEnd) {
		const headerId = buffer.readUInt16LE(offset);
		const dataSize = buffer.readUInt16LE(offset + 2);
		offset += 4;

		// zip64 extended information extra field
		if (headerId === 0x0001) {
			const result: {
				uncompressedSize?: number;
				compressedSize?: number;
				localHeaderOffset?: number;
			} = {};
			let fieldOffset = offset;

			if (needUncompressed && fieldOffset + 8 <= offset + dataSize) {
				result.uncompressedSize = Number(buffer.readBigUInt64LE(fieldOffset));
				fieldOffset += 8;
			}

			if (needCompressed && fieldOffset + 8 <= offset + dataSize) {
				result.compressedSize = Number(buffer.readBigUInt64LE(fieldOffset));
				fieldOffset += 8;
			}

			if (needOffset && fieldOffset + 8 <= offset + dataSize) {
				result.localHeaderOffset = Number(buffer.readBigUInt64LE(fieldOffset));
				fieldOffset += 8;
			}

			return result;
		}

		offset += dataSize;
	}

	return {};
}

function dosDateTimeToDate(dosDate: number, dosTime: number): Date {
	const day = dosDate & 0x1f;
	const month = ((dosDate >> 5) & 0x0f) - 1;
	const year = ((dosDate >> 9) & 0x7f) + 1980;

	const second = (dosTime & 0x1f) * 2;
	const minute = (dosTime >> 5) & 0x3f;
	const hour = (dosTime >> 11) & 0x1f;

	return new Date(year, month, day, hour, minute, second);
}

export function parseLocalFileHeader(buffer: Buffer): {
	filenameLength: number;
	extraFieldLength: number;
	dataOffset: number;
} {
	const filenameLength = buffer.readUInt16LE(26);
	const extraFieldLength = buffer.readUInt16LE(28);
	const dataOffset = 30 + filenameLength + extraFieldLength;

	return {
		filenameLength,
		extraFieldLength,
		dataOffset,
	};
}
