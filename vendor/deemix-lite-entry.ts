import type { Deezer } from "deezer-sdk";
import { Downloader } from "@/downloader.js";
import BasePlugin from "@/plugins/base.js";
import { generateTrackItem } from "@/download-objects/generateTrackItem.js";
import { generateArtistTopItem } from "@/download-objects/generateArtistTopItem.js";
import {
	generateArtistItem,
	generatePlaylistItem,
} from "@/download-objects/generatePlaylistItem.js";
import { generateAlbumItem } from "@/download-objects/generateAlbumItem.js";
import { DEFAULT_SETTINGS } from "@/settings.js";

async function parseLink(link: string) {
	if (link.includes("deezer.page.link")) {
		const { default: got } = await import("got");
		const response = await got.get(link);
		link = response.url;
	}

	if (link.includes("?")) link = link.slice(0, link.indexOf("?"));
	if (link.includes("&")) link = link.slice(0, link.indexOf("&"));
	if (link.endsWith("/")) link = link.slice(0, -1);

	let link_type: string | null = null;
	let link_id: string | null = null;
	let link_data: RegExpExecArray | null;

	if (!link.includes("deezer")) return [link, link_type, link_id] as const;

	if (link.search(/\/track\/(.+)/g) !== -1) {
		link_type = "track";
		link_id = /\/track\/(.+)/g.exec(link)![1];
	} else if (link.search(/\/playlist\/(\d+)/g) !== -1) {
		link_type = "playlist";
		link_id = /\/playlist\/(\d+)/g.exec(link)![1];
	} else if (link.search(/\/album\/(.+)/g) !== -1) {
		link_type = "album";
		link_id = /\/album\/(.+)/g.exec(link)![1];
	} else if (link.search(/\/artist\/(\d+)\/top_track/g) !== -1) {
		link_type = "artist_top";
		link_id = /\/artist\/(\d+)\/top_track/g.exec(link)![1];
	} else if (link.search(/\/artist\/(\d+)\/(.+)/g) !== -1) {
		link_data = /\/artist\/(\d+)\/(.+)/g.exec(link);
		link_type = `artist_${link_data![2]}`;
		link_id = link_data![1];
	} else if (link.search(/\/artist\/(\d+)/g) !== -1) {
		link_type = "artist";
		link_id = /\/artist\/(\d+)/g.exec(link)![1];
	}

	return [link, link_type, link_id] as const;
}

async function generateDownloadObject(
	dz: Deezer,
	link: string,
	bitrate: number,
	plugins: Record<string, BasePlugin> = {},
	listener: any
) {
	let link_type: string | null = null;
	let link_id: string | null = null;

	[link, link_type, link_id] = await parseLink(link);

	if (!link_type || !link_id) {
		for (const pluginName in plugins) {
			const downloadObject = await plugins[pluginName].generateDownloadObject(
				dz,
				link,
				bitrate,
				listener
			);
			if (downloadObject) return downloadObject;
		}
		throw new Error(`LinkNotRecognized: ${link}`);
	}

	if (link_type === "track") return generateTrackItem(dz, link_id, bitrate);
	if (link_type === "album") return generateAlbumItem(dz, link_id, bitrate);
	if (link_type === "playlist") return generatePlaylistItem(dz, link_id, bitrate);
	if (link_type === "artist") return generateArtistItem(dz, link_id, bitrate, listener, "all");
	if (link_type === "artist_top") return generateArtistTopItem(dz, link_id, bitrate);
	if (link_type.startsWith("artist_")) {
		const tab = link_type.slice(7);
		return generateArtistItem(dz, link_id, bitrate, listener, tab);
	}
	throw new Error(`LinkNotSupported: ${link}`);
}

export { Downloader, generateDownloadObject, parseLink };
export { DEFAULT_SETTINGS };
