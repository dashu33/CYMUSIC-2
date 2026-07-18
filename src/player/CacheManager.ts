import { logError, logInfo } from '@/helpers/logger'
import { importedLocalMusicStore, qualityStore } from './PlayerStore'
import PersistStatus from '@/store/PersistStatus'
import * as FileSystem from 'expo-file-system'
import RNFS from 'react-native-fs'

const cacheDir = FileSystem.documentDirectory + 'musicCache/'
const AUDIO_EXTS = new Set(['mp3', 'flac', 'm4a', 'wav', 'aac', 'ogg'])

export type CacheMeta = {
	id: string
	title: string
	artist: string
	album?: string
	artwork?: string
	platform?: string
	quality?: string
	duration?: number
	cachedAt?: number
}

function sanitizeFilename(str: string): string {
	return str.replace(/[/\\?%*:|"<>]/g, '-')
}

function stripFileScheme(path: string): string {
	return (path || '').replace(/^file:\/\//, '')
}

function ensureFileUrl(path: string): string {
	if (!path) return path
	return path.startsWith('file://') ? path : `file://${path}`
}

const isPathInsideCache = (path: string): boolean => {
	const normalized = stripFileScheme(path)
	const cacheRoot = stripFileScheme(cacheDir)
	return normalized.startsWith(cacheRoot)
}

function getMetaPath(audioPath: string): string {
	const bare = stripFileScheme(audioPath).replace(/\.(mp3|flac|m4a|wav|aac|ogg)$/i, '')
	return ensureFileUrl(`${bare}.json`)
}

function musicItemToMeta(musicItem: IMusic.IMusicItem): CacheMeta {
	return {
		id: String(musicItem.id),
		title: musicItem.title || '未知标题',
		artist: musicItem.artist || '未知艺术家',
		album: musicItem.album,
		artwork: musicItem.artwork,
		platform: musicItem.platform || musicItem.source,
		quality: qualityStore.getValue(),
		duration: musicItem.duration,
		cachedAt: Date.now(),
	}
}

function metaToMusicItem(meta: CacheMeta, filePath: string): IMusic.IMusicItem {
	return {
		id: meta.id,
		title: meta.title || '未知标题',
		artist: meta.artist || '未知艺术家',
		album: meta.album || '未知专辑',
		artwork: meta.artwork,
		url: ensureFileUrl(filePath),
		platform: meta.platform || 'cache',
		duration: meta.duration || 0,
		source: meta.platform || 'cache',
	} as IMusic.IMusicItem
}

async function writeCacheMeta(musicItem: IMusic.IMusicItem, localPath: string) {
	try {
		const metaPath = getMetaPath(localPath)
		const meta = musicItemToMeta(musicItem)
		await FileSystem.writeAsStringAsync(metaPath, JSON.stringify(meta))
	} catch (error) {
		logError('写入缓存元数据失败:', error)
	}
}

async function readCacheMeta(audioPath: string): Promise<CacheMeta | null> {
	try {
		const metaPath = getMetaPath(audioPath)
		const info = await FileSystem.getInfoAsync(metaPath)
		if (!info.exists) return null
		const raw = await FileSystem.readAsStringAsync(metaPath)
		return JSON.parse(raw) as CacheMeta
	} catch {
		return null
	}
}

export const ensureCacheDirExists = async () => {
	const dirInfo = await FileSystem.getInfoAsync(cacheDir)
	if (!dirInfo.exists) {
		await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true })
	}
}

export const ensureDirExists = async (dirPath: string) => {
	const dirInfo = await FileSystem.getInfoAsync(dirPath)
	if (!dirInfo.exists) {
		await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true })
	}
}

export const getLocalFilePath = (musicItem: IMusic.IMusicItem): string => {
	const format = qualityStore.getValue() === 'flac' ? 'flac' : 'mp3'
	const safeTitle = sanitizeFilename(musicItem.title || '')
	const safeArtist = sanitizeFilename(musicItem.artist || '')
	const platformId =
		musicItem.platform && musicItem.id
			? `${musicItem.platform}_${musicItem.id}`
			: `${safeTitle}-${safeArtist}`
	return `${cacheDir}${platformId}.${format}`
}

/** 返回实际存在的缓存文件路径（兼容不同音质扩展名） */
export const findCachedFilePath = async (
	musicItem: IMusic.IMusicItem,
): Promise<string | null> => {
	const preferred = getLocalFilePath(musicItem)
	const preferredInfo = await FileSystem.getInfoAsync(preferred)
	if (preferredInfo.exists) return preferred

	try {
		await ensureCacheDirExists()
		const files = await FileSystem.readDirectoryAsync(cacheDir)
		const platformId =
			musicItem.platform && musicItem.id
				? `${musicItem.platform}_${musicItem.id}`
				: null
		const id = String(musicItem.id)

		for (const name of files) {
			const ext = name.split('.').pop()?.toLowerCase() || ''
			if (!AUDIO_EXTS.has(ext)) continue
			const base = name.replace(/\.[^.]+$/, '')
			if (
				(platformId && base === platformId) ||
				base === id ||
				base.endsWith(`_${id}`)
			) {
				return `${cacheDir}${name}`
			}
			const meta = await readCacheMeta(`${cacheDir}${name}`)
			if (meta?.id && String(meta.id) === id) {
				return `${cacheDir}${name}`
			}
		}
	} catch {
		// ignore
	}
	return null
}

export const isCached = async (musicItem: IMusic.IMusicItem): Promise<boolean> => {
	const path = await findCachedFilePath(musicItem)
	return !!path
}

export const downloadToCache = async (musicItem: IMusic.IMusicItem): Promise<string> => {
	try {
		await ensureCacheDirExists()
		const localPath = getLocalFilePath(musicItem)
		const downloadResult = await RNFS.downloadFile({
			fromUrl: musicItem.url,
			toFile: stripFileScheme(localPath),
			progressDivider: 1,
			progress: (res) => {
				const progress = res.bytesWritten / res.contentLength
				logInfo(`下载进度: ${(progress * 100).toFixed(2)}%`)
			},
		}).promise

		if (downloadResult.statusCode === 200) {
			await writeCacheMeta(musicItem, localPath)
			logInfo('音频文件已缓存到本地:', localPath)
			return localPath
		} else {
			throw new Error(`下载失败，状态码: ${downloadResult.statusCode}`)
		}
	} catch (error) {
		logError('下载音频文件时出错:', error)
		throw error
	}
}

export const clearCache = async () => {
	const dirInfo = await FileSystem.getInfoAsync(cacheDir)
	if (dirInfo.exists) {
		await FileSystem.deleteAsync(cacheDir, { idempotent: true })
		const importedLocalMusic = importedLocalMusicStore.getValue() || []
		const updatedImportedLocalMusic = importedLocalMusic.filter((item: IMusic.IMusicItem) => {
			const url = item.url || ''
			return !isPathInsideCache(url)
		})
		importedLocalMusicStore.setValue(updatedImportedLocalMusic)
		PersistStatus.set('music.importedLocalMusic', updatedImportedLocalMusic)
		logInfo('缓存已清理')
	} else {
		logInfo('缓存目录不存在，无需清理')
	}
}

/** 扫描磁盘缓存目录，返回可展示的曲目列表 */
export const listCachedMusic = async (): Promise<IMusic.IMusicItem[]> => {
	try {
		const dirInfo = await FileSystem.getInfoAsync(cacheDir)
		if (!dirInfo.exists) return []

		const files = await FileSystem.readDirectoryAsync(cacheDir)
		const audioFiles = files.filter((name) => {
			const ext = name.split('.').pop()?.toLowerCase() || ''
			return AUDIO_EXTS.has(ext)
		})

		const items: IMusic.IMusicItem[] = []
		for (const name of audioFiles) {
			const filePath = `${cacheDir}${name}`
			const meta = await readCacheMeta(filePath)
			if (meta?.id) {
				items.push(metaToMusicItem(meta, filePath))
				continue
			}

			// 无元数据：从文件名 platform_id.ext 解析
			const base = name.replace(/\.[^.]+$/, '')
			const underscore = base.indexOf('_')
			let platform = 'cache'
			let id = base
			if (underscore > 0) {
				platform = base.slice(0, underscore)
				id = base.slice(underscore + 1)
			}
			items.push({
				id,
				title: base,
				artist: '缓存',
				album: '本地缓存',
				url: ensureFileUrl(filePath),
				platform,
				duration: 0,
				source: platform,
			} as IMusic.IMusicItem)
		}
		return items
	} catch (error) {
		logError('列出缓存音乐失败:', error)
		return []
	}
}

/** 删除单条缓存（文件 + 元数据 + 本地列表中的对应项） */
export const deleteCachedMusic = async (
	musicItem: IMusic.IMusicItem | string,
): Promise<void> => {
	try {
		const id = typeof musicItem === 'string' ? musicItem : String(musicItem.id)
		const item = typeof musicItem === 'string' ? null : musicItem
		const pathsToDelete = new Set<string>()

		if (item) {
			const found = await findCachedFilePath(item)
			if (found) pathsToDelete.add(found)
			if (item.url && isPathInsideCache(item.url)) {
				pathsToDelete.add(item.url)
			}
		}

		const dirInfo = await FileSystem.getInfoAsync(cacheDir)
		if (dirInfo.exists) {
			const files = await FileSystem.readDirectoryAsync(cacheDir)
			const platformId =
				item?.platform && item?.id ? `${item.platform}_${item.id}` : null

			for (const name of files) {
				const filePath = `${cacheDir}${name}`
				const ext = name.split('.').pop()?.toLowerCase() || ''
				if (!AUDIO_EXTS.has(ext)) continue

				const base = name.replace(/\.[^.]+$/, '')
				const meta = await readCacheMeta(filePath)
				const metaId = meta?.id != null ? String(meta.id) : null
				if (
					metaId === id ||
					base.endsWith(`_${id}`) ||
					base === id ||
					(platformId && base === platformId)
				) {
					pathsToDelete.add(filePath)
				}
			}
		}

		for (const path of pathsToDelete) {
			const bare = stripFileScheme(path)
			const candidates = [ensureFileUrl(bare), bare]
			for (const candidate of candidates) {
				try {
					const info = await FileSystem.getInfoAsync(candidate)
					if (info.exists) {
						await FileSystem.deleteAsync(candidate, { idempotent: true })
						break
					}
				} catch {
					// try next
				}
			}
			try {
				await FileSystem.deleteAsync(getMetaPath(ensureFileUrl(bare)), {
					idempotent: true,
				})
			} catch {
				// ignore missing meta
			}
		}

		const pathSet = new Set([...pathsToDelete].map(stripFileScheme))
		const importedLocalMusic = importedLocalMusicStore.getValue() || []
		const updated = importedLocalMusic.filter((entry: IMusic.IMusicItem) => {
			if (String(entry.id) === id) return false
			const url = stripFileScheme(entry.url || '')
			return !pathSet.has(url)
		})
		importedLocalMusicStore.setValue(updated)
		PersistStatus.set('music.importedLocalMusic', updated)

		logInfo('已删除缓存:', id)
	} catch (error) {
		logError('删除缓存失败:', error)
		throw error
	}
}

export const getCacheSizeBytes = async (): Promise<number> => {
	try {
		const dirInfo = await FileSystem.getInfoAsync(cacheDir)
		if (!dirInfo.exists) return 0

		const files = await FileSystem.readDirectoryAsync(cacheDir)
		let total = 0
		for (const name of files) {
			const info = await FileSystem.getInfoAsync(`${cacheDir}${name}`, { size: true })
			if (info.exists && 'size' in info && typeof info.size === 'number') {
				total += info.size
			}
		}
		return total
	} catch (error) {
		logError('获取缓存大小失败:', error)
		return 0
	}
}

export const formatCacheSize = (bytes: number): string => {
	if (!bytes || bytes <= 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	let size = bytes
	let unit = 0
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024
		unit++
	}
	const digits = unit === 0 ? 0 : size >= 10 ? 1 : 2
	return `${size.toFixed(digits)} ${units[unit]}`
}

/** 合并「手动导入」与「磁盘缓存」，供本地/缓存页展示 */
export const getLocalAndCachedMusic = async (): Promise<IMusic.IMusicItem[]> => {
	const imported = importedLocalMusicStore.getValue() || []
	const diskCached = await listCachedMusic()
	const byId = new Map<string, IMusic.IMusicItem>()

	for (const item of diskCached) {
		byId.set(String(item.id), item)
	}
	// 导入列表优先（含用户手动导入的非缓存文件，以及更完整元数据）
	for (const item of imported) {
		const key = String(item.id)
		const existing = byId.get(key)
		if (!existing) {
			byId.set(key, item)
			continue
		}
		// 合并：保留导入的展示信息，路径优先可用的 file
		byId.set(key, {
			...existing,
			...item,
			url: item.url || existing.url,
			artwork: item.artwork || existing.artwork,
		})
	}

	return Array.from(byId.values())
}

export const isCacheFileUrl = (url?: string): boolean => {
	if (!url) return false
	return isPathInsideCache(url)
}

export { cacheDir }
