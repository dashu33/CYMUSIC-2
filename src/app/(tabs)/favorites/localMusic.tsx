import localImage from '@/assets/local.png'
import { PlaylistTracksList } from '@/components/PlaylistTracksList'
import { unknownTrackImageUri } from '@/constants/images'
import { ThemeColors, screenPadding } from '@/constants/tokens'
import { logError, logInfo } from '@/helpers/logger'
import myTrackPlayer, { importedLocalMusicStore } from '@/helpers/trackPlayerIndex'
import { Playlist } from '@/helpers/types'
import { searchMusicInfoByName } from '@/helpers/userApi/getMusicSource'
import { useThemeColors } from '@/hooks/useAppTheme'
import { useDefaultStyles } from '@/styles'
import i18n from '@/utils/i18n'
import MusicInfo from '@/utils/musicInfo'
import * as DocumentPicker from 'expo-document-picker'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Alert,
	Image,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { Track } from 'react-native-track-player'
import { useFocusEffect } from 'expo-router'

const LocalMusicScreen = () => {
	const colors = useThemeColors()
	const defaultStyles = useDefaultStyles()
	const styles = useMemo(() => createStyles(colors), [colors])
	const importedTracks = importedLocalMusicStore.useValue() || []
	const [displayTracks, setDisplayTracks] = useState<IMusic.IMusicItem[]>([])
	const [cacheSizeLabel, setCacheSizeLabel] = useState('0 B')
	const [isLoading, setIsLoading] = useState(false)

	const playListItem = {
		name: 'Local',
		id: 'local',
		tracks: [],
		title: i18n.t('appTab.localOrCachedSongs'),
		coverImg: Image.resolveAssetSource(localImage).uri,
		description: i18n.t('appTab.localOrCachedSongs'),
	}
	const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
	const [selectedTracks, setSelectedTracks] = useState<Set<string>>(new Set())

	const refreshList = useCallback(async () => {
		try {
			const [merged, sizeBytes] = await Promise.all([
				myTrackPlayer.getLocalAndCachedMusic(),
				myTrackPlayer.getCacheSizeBytes(),
			])
			setDisplayTracks(merged)
			setCacheSizeLabel(myTrackPlayer.formatCacheSize(sizeBytes))
		} catch (error) {
			logError('刷新本地/缓存列表失败:', error)
		}
	}, [])

	// 导入列表变化时同步
	useEffect(() => {
		refreshList()
	}, [importedTracks, refreshList])

	// 页面聚焦时重新扫描磁盘缓存（自动缓存可能不在 imported 列表中）
	useFocusEffect(
		useCallback(() => {
			refreshList()
		}, [refreshList]),
	)

	const toggleMultiSelectMode = () => {
		setIsMultiSelectMode(!isMultiSelectMode)
		setSelectedTracks(new Set())
	}

	const deleteSelectedTracks = async () => {
		const ids = Array.from(selectedTracks)
		for (const trackId of ids) {
			const track = displayTracks.find((t) => String(t.id) === String(trackId))
			if (track && myTrackPlayer.isCacheFileUrl(track.url)) {
				await myTrackPlayer.deleteCachedMusic(track)
			} else {
				await myTrackPlayer.deleteImportedLocalMusic(trackId)
			}
		}
		setSelectedTracks(new Set())
		setIsMultiSelectMode(false)
		await refreshList()
	}

	const toggleSelectAll = () => {
		if (!displayTracks || !Array.isArray(displayTracks)) {
			return
		}
		if (selectedTracks.size === displayTracks.length) {
			setSelectedTracks(new Set())
		} else {
			const allTrackIds = new Set(displayTracks.map((track) => String(track.id)))
			setSelectedTracks(allTrackIds)
		}
	}

	const toggleTrackSelection = (trackId: string) => {
		setSelectedTracks((prevSelected) => {
			const newSelected = new Set(prevSelected)
			const key = String(trackId)
			if (newSelected.has(key)) {
				newSelected.delete(key)
			} else {
				newSelected.add(key)
			}
			return newSelected
		})
	}

	const exportSelectedTracks = async () => {
		if (selectedTracks.size === 0) {
			Alert.alert('提示', '请先选择要导出的歌曲')
			setIsMultiSelectMode(false)
			return
		}
		try {
			Alert.alert('文件已保存到: 文件 App > 我的 iPhone > CyMusic > importedLocalMusic')
		} catch (error) {
			console.error('导出过程中出错:', error)
			Alert.alert('错误', '导出过程中出现错误，请重试。')
		}
	}

	const importLocalMusic = async () => {
		try {
			setIsLoading(true)
			const result = await DocumentPicker.getDocumentAsync({
				type: 'audio/*',
				multiple: true,
			})

			if (result.canceled) {
				logInfo('用户取消了文件选择')
				setIsLoading(false)
				return
			}
			console.log('result.assets:', result.assets)
			if (result.assets.length > 50) {
				Alert.alert('提示', '一次最多只能导入50首歌曲')
				setIsLoading(false)
				return
			}
			const newTracks: IMusic.IMusicItem[] = await Promise.all(
				result.assets
					.filter((file) => !myTrackPlayer.isExistImportedLocalMusic(file.name))
					.map(async (file) => {
						const metadata = await MusicInfo.getMusicInfoAsync(file.uri, {
							title: true,
							artist: true,
							album: true,
							genre: true,
							picture: true,
						})

						return {
							id: file.uri,
							title: metadata?.title || file.name || '未知标题',
							artist: metadata?.artist || '未知艺术家',
							album: metadata?.album || '未知专辑',
							artwork: unknownTrackImageUri,
							url: file.uri,
							platform: 'local',
							duration: 0,
							genre: file.name || '',
						}
					}),
			)
			if (newTracks.length === 0) {
				console.log('没有新导入的音轨')
				setIsLoading(false)
				return
			}

			const processedTracks = await Promise.all(
				newTracks.map(async (track) => {
					if (track.title !== '未知标题') {
						try {
							console.log(track.title)
							const searchResult = await searchMusicInfoByName(track.title)
							logInfo('搜索结果:', searchResult)
							if (searchResult != null) {
								return {
									...track,
									id: searchResult.songmid || track.id,
									artwork: searchResult.artwork || track.artwork,
									album: searchResult.albumName || track.album,
								}
							} else {
								logError('没有匹配到歌曲')
							}
						} catch (error) {
							logError(`获取歌曲 "${track.title}" 信息时出错:`, error)
						}
					}
					return track
				}),
			)

			console.log('处理后的音轨:', processedTracks)
			myTrackPlayer.addImportedLocalMusic(processedTracks)
		} catch (err) {
			logError('导入本地音乐时出错:', err)
		} finally {
			setIsLoading(false)
		}
	}

	async function deleteLocalMusic(trackId: string): Promise<void> {
		const track = displayTracks.find((t) => String(t.id) === String(trackId))
		try {
			if (track && myTrackPlayer.isCacheFileUrl(track.url)) {
				await myTrackPlayer.deleteCachedMusic(track)
			} else {
				await myTrackPlayer.deleteImportedLocalMusic(trackId)
			}
			await refreshList()
		} catch (error) {
			logError('删除本地/缓存歌曲失败:', error)
			Alert.alert(
				i18n.t('settings.actions.cache.error'),
				i18n.t('settings.actions.cache.deleteErrorMessage'),
			)
		}
	}

	return (
		<View style={defaultStyles.container}>
			{(isLoading) && (
				<View style={styles.loadingOverlay}>
					<ActivityIndicator size="large" color={colors.loading} />
				</View>
			)}
			<ScrollView
				contentInsetAdjustmentBehavior="automatic"
				style={{ paddingHorizontal: screenPadding.horizontal }}
			>
				<Text style={styles.cacheHint}>
					{i18n.t('appTab.cacheSizeLabel', { size: cacheSizeLabel })}
				</Text>
				<PlaylistTracksList
					playlist={playListItem as Playlist}
					tracks={displayTracks as Track[]}
					showImportMenu={true}
					onImportTrack={importLocalMusic}
					allowDelete={true}
					onDeleteTrack={deleteLocalMusic}
					isMultiSelectMode={isMultiSelectMode}
					selectedTracks={selectedTracks}
					onToggleSelection={toggleTrackSelection}
					toggleMultiSelectMode={toggleMultiSelectMode}
					onSelectAll={toggleSelectAll}
					deleteSelectedTracks={deleteSelectedTracks}
					exportSelectedTracks={exportSelectedTracks}
				/>
			</ScrollView>
		</View>
	)
}

const createStyles = (colors: ThemeColors) =>
	StyleSheet.create({
		loadingOverlay: {
			position: 'absolute',
			left: 0,
			right: 0,
			top: 0,
			bottom: 0,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.overlay,
			zIndex: 1000,
		},
		header: {
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
			padding: 10,
		},
		cacheHint: {
			color: colors.textMuted,
			fontSize: 13,
			opacity: 0.9,
			marginBottom: 8,
			marginTop: 4,
		},
	})

export default LocalMusicScreen
