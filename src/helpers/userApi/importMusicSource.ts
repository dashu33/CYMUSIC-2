import {
	createChkszPortalMusicApi,
	isChkszPortalUrl,
	looksLikePortalHtml,
	normalizePortalUrl,
} from './chkszPortalSource'
import { adaptLxMusicScript, isLxMusicScript } from './lxMusicSourceAdapter'

export interface ModuleExports {
	id?: string
	author?: string
	name?: string
	version?: string
	srcUrl?: string
	getMusicUrl?: (
		songname: string,
		artist: string,
		songmid: string,
		quality: string,
	) => Promise<string>
}

export async function createMusicApiFromScript(rawScript: string): Promise<IMusic.MusicApi> {
	const script = rawScript?.trim?.() ?? ''
	if (!script) {
		throw new Error('音源脚本为空')
	}

	// 允许直接粘贴门户 HTML / 门户地址文本
	if (looksLikePortalHtml(script) || isChkszPortalUrl(script)) {
		return createChkszPortalMusicApi(
			isChkszPortalUrl(script) ? normalizePortalUrl(script) : undefined,
		)
	}

	if (isLxMusicScript(script)) {
		return adaptLxMusicScript(script)
	}

	const module: { exports: ModuleExports } = { exports: {} }
	const require = () => {}
	const moduleFunc = new Function('module', 'exports', 'require', script)
	moduleFunc(module, module.exports, require)

	if (typeof module.exports.getMusicUrl !== 'function') {
		throw new Error('脚本缺少 getMusicUrl 方法')
	}

	return {
		id: module.exports.id || '',
		platform: 'tx',
		author: module.exports.author || '',
		name: module.exports.name || '',
		version: module.exports.version || '',
		srcUrl: module.exports.srcUrl || '',
		script,
		scriptType: 'cymusic',
		isSelected: false,
		getMusicUrl: module.exports.getMusicUrl,
	}
}

export async function fetchScriptFromUrl(url: string): Promise<string> {
	const target = url?.trim?.()
	if (!target) {
		throw new Error('链接为空')
	}

	// 门户站不直接当脚本下载，走自动生成音源
	if (isChkszPortalUrl(target)) {
		return `__CHKSZ_PORTAL__:${normalizePortalUrl(target)}`
	}

	const response = await fetch(target)
	if (!response.ok) {
		throw new Error(`HTTP error! status: ${response.status}`)
	}
	const text = await response.text()
	if (looksLikePortalHtml(text) || isChkszPortalUrl(target)) {
		return `__CHKSZ_PORTAL__:${normalizePortalUrl(target)}`
	}
	return text
}

export function looksLikeScriptText(text?: string | null): boolean {
	if (!text) return false
	const normalized = text.trim()
	return (
		/module\s*\.\s*exports\s*\.\s*getMusicUrl/.test(normalized) ||
		isLxMusicScript(normalized) ||
		looksLikePortalHtml(normalized) ||
		normalized.startsWith('__CHKSZ_PORTAL__:')
	)
}

export async function createMusicApiFromUrl(url: string): Promise<IMusic.MusicApi> {
	const target = url?.trim?.()
	if (!target) {
		throw new Error('链接为空')
	}

	if (isChkszPortalUrl(target)) {
		return createChkszPortalMusicApi(target)
	}

	const sourceCode = await fetchScriptFromUrl(target)
	if (sourceCode.startsWith('__CHKSZ_PORTAL__:')) {
		return createChkszPortalMusicApi(sourceCode.replace('__CHKSZ_PORTAL__:', ''))
	}
	if (looksLikePortalHtml(sourceCode)) {
		return createChkszPortalMusicApi(target)
	}

	const musicApi = await createMusicApiFromScript(sourceCode)
	return {
		...musicApi,
		srcUrl: musicApi.srcUrl || target,
	}
}
