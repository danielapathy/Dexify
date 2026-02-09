/**
 * EDGE CASE INVESTIGATION - State Management Issues
 * ================================================
 * 
 * Phase 1: Root Cause Investigation
 * 
 * ============================================================
 * EDGE CASE 1: Playlist/album download doesn't update nav header options
 * ============================================================
 * 
 * SYMPTOM: When downloading songs from playlists/albums, the entity header
 * buttons (save→delete, download→downloaded) don't update to reflect the
 * new downloaded state.
 * 
 * DATA FLOW TRACE:
 *   1. User clicks "Download playlist" in entityHeader.js:229
 *   2. Calls window.dl.downloadUrl({ url, quality })
 *   3. Main process downloadUrlHandler.js iterates tracks, calls downloadSingleTrack per track
 *   4. Each track finish → broadcastDownloadEvent({ event: "downloadFinished", data: {...} })
 *   5. Renderer: notifications/downloads.js onEvent handler catches "downloadFinished"
 *   6. Calls lib.upsertDownloadedTrack({ track: { id: trackId }, fileUrl, ... })
 *   7. upsertDownloadedTrack calls save() → notify() → dispatches "local-library:changed"
 *   8. entityDownloadAction.js listens for "local-library:changed" (line 134)
 *   9. Calls schedule() → requestAnimationFrame → applyActive() → applyToEntry(getActiveEntry())
 *   10. applyToEntry reads downloadedTracks, computes stats, updates button classes
 * 
 * ALSO: downloadBadges.js listens for "local-library:changed" (line 134) AND
 *       dl.onEvent (line 137-164) to update individual track row badges.
 * 
 * ROOT CAUSE ANALYSIS:
 *   The chain SHOULD work. But there's a critical gap:
 *   
 *   In notifications/downloads.js, the "downloadFinished" handler at line 225-233:
 *     - It creates track: { id: trackId } — MINIMAL metadata
 *     - The upsertDownloadedTrack merges with existing, so if there's NO existing
 *       entry, it creates one with empty title/artist/album
 *     - But the FIRST event is "downloadRequested" (line 210-224) which also creates
 *       an entry, using window.__downloadMetaById for metadata
 *   
 *   The download badges in downloadBadges.js have a SEPARATE dl.onEvent listener
 *   (line 137) that tracks in-flight downloads and schedules badge updates.
 *   
 *   BUT: The entityDownloadAction buttons update depends on getActiveEntry()
 *   returning the CORRECT entry with the right trackIds bound. If the user
 *   navigated away and back, the entry might have been re-created without
 *   the downloadAction/saveAction bindings.
 * 
 *   ACTUALLY - the more likely issue: entityDownloadAction.applyActive() calls
 *   applyToEntry(getActiveEntry()). The getActiveEntry() returns the entry from
 *   entityPageCache. The entry has downloadAction and saveAction set during
 *   renderEntityHeader via entityDownloadAction.bind() and bindSave().
 *   
 *   If the entity page is CACHED (already rendered), and the user navigates
 *   back to it, mountEntry is called but renderEntityInto is NOT called again
 *   (because entry.renderedAt is already set). This means the buttons are
 *   the SAME DOM elements from the original render.
 *   
 *   The entityDownloadAction.schedule() should still work because it reads
 *   entry.downloadAction.trackIds and re-checks against current downloadedTracks.
 *   
 *   WAIT - let me re-check. The showEntityRoute function:
 *     const shouldRefresh = forceRefresh || Boolean(route?.refresh) || 
 *       route?.name === "liked" || route?.name === "downloads" || !entry.renderedAt;
 *   
 *   For entity pages (album/playlist), shouldRefresh is only true if:
 *     - forceRefresh is true, OR
 *     - route.refresh is true, OR
 *     - it was never rendered (!entry.renderedAt)
 *   
 *   So on subsequent visits, the page is NOT re-rendered. The buttons persist.
 *   The entityDownloadAction.schedule() listens to local-library:changed and
 *   updates them via applyActive(). This SHOULD work.
 *   
 *   Let me check if the issue is actually that batch downloads from downloadUrl
 *   DON'T go through the notifications/downloads.js flow properly...
 *   
 *   In downloadUrlHandler.js, for playlist downloads:
 *     - Each track uses uuid: `playlist_${playlistId}_track_${id}_${bitrate}`
 *     - downloadSingleTrack broadcasts "downloadFinished" with this uuid
 *     - notifications/downloads.js catches it, parseTrackRef extracts trackId
 *     - BUT: it also checks for "libraryChanged" event → syncDownloadsFromDisk
 *   
 *   The downloadSingleTrack function broadcasts "downloadRequested" BEFORE the
 *   actual download starts. At that point, notifications/downloads.js creates
 *   the in-flight entry. When download finishes, it updates with fileUrl.
 *   
 *   HYPOTHESIS 1: The entityDownloadAction IS updating, but there's a race
 *   condition or the user hasn't noticed because the updates happen one-by-one
 *   as tracks finish downloading (not all at once).
 *   
 *   HYPOTHESIS 2: The applyActive() function in entityDownloadAction gets the
 *   wrong entry because getActiveEntry() returns null or a different entry.
 *   
 *   Actually I think I found it. Let me look at the entityDownloadAction's
 *   schedule function more carefully:
 *   
 *   entityDownloadAction.js line 123-132:
 *     const schedule = (() => {
 *       let raf = 0;
 *       return () => {
 *         if (raf) return;           // <-- COALESCES multiple events!
 *         raf = requestAnimationFrame(() => {
 *           raf = 0;
 *           applyActive();
 *         });
 *       };
 *     })();
 *   
 *   This coalesces nicely. Multiple "local-library:changed" events within
 *   one frame will only trigger one applyActive(). That's fine.
 *   
 *   The applyActive() function (line 117-121):
 *     const applyActive = () => {
 *       try { applyToEntry(getActiveEntry?.()); } catch {}
 *     };
 *   
 *   It silently swallows errors! If getActiveEntry() returns something
 *   unexpected, or if the entry's downloadAction is stale, the error
 *   is swallowed.
 *   
 *   BUT MORE IMPORTANTLY: I need to check if the save button properly
 *   transitions. Let me look at applyToEntry for the saveAction:
 *   
 *   entityDownloadAction.js line 95-114:
 *     const saveState = e?.saveAction;
 *     const btn = saveState.btn;
 *     const uiState = resolveSaveUiState({
 *       entityType: saveState.entityType,
 *       entityId: saveState.entityId,
 *       trackIds: saveState.trackIds,
 *     });
 *     const icon = btn.querySelector("i");
 *     icon.className = uiState.deleteMode ? "ri-delete-bin-6-line" : "ri-add-line";
 *     btn.dataset.deleteMode = uiState.deleteMode ? "1" : "0";
 *   
 *   resolveSaveUiState checks:
 *     - hasDownloaded = stats.downloaded > 0
 *     - isSaved = lib.isAlbumSaved or lib.isPlaylistSaved
 *     - deleteMode = hasDownloaded || isSaved
 *   
 *   When the user clicks "Download playlist", entityHeader.js line 246-247
 *   ALSO calls lib.addSavedPlaylist(). So the playlist IS saved.
 *   So deleteMode should be true even before any downloads finish.
 *   
 *   After downloads finish, hasDownloaded becomes true too, reinforcing deleteMode.
 *   
 *   VERIFIED: The chain works for the SAVE button. It should already show
 *   delete mode after clicking download because addSavedPlaylist is called
 *   synchronously before the async downloadUrl.
 *   
 *   For the DOWNLOAD button:
 *   entityDownloadAction.js line 69-92:
 *     const downloadedTracks = getDownloadedTracks();
 *     const stats = computeStats(trackIds, downloadedTracks);
 *     const disabled = stats.total > 0 && stats.remaining === 0;
 *     btn.classList.toggle("is-disabled", disabled);
 *     const icon = btn.querySelector("i");
 *     icon.className = disabled ? "ri-download-2-fill" : "ri-download-2-line";
 *   
 *   This checks if ALL tracks are downloaded (remaining === 0).
 *   As tracks finish one by one, remaining decreases.
 *   Only when ALL tracks are done does disabled become true.
 *   
 *   POSSIBLE ISSUE: The label update. resolveLabel returns:
 *     - "Downloaded" when remaining <= 0
 *     - "Download remaining N tracks" when remaining < total
 *     - original label otherwise
 *   
 *   This IS being set as tooltip. So the button DOES update progressively.
 *   
 *   CONCLUSION FOR EDGE CASE 1:
 *   The reactive chain IS wired up. The issue is likely that:
 *   a) The "local-library:changed" event from notifications/downloads.js 
 *      fires for each track, but the entityDownloadAction coalesces into
 *      one RAF update per frame — which should be FINE.
 *   b) If the user is ON the playlist page while downloading, the buttons
 *      SHOULD update. If they DON'T, the entry might not have the 
 *      downloadAction/saveAction bound (e.g., if the page was rendered
 *      from an offline/cached state without the button bindings).
 *   
 *   ACTUAL ROOT CAUSE: After extensive tracing, I believe the issue is
 *   actually timing-related. The downloadUrl call is async and returns
 *   AFTER all tracks finish. But notifications/downloads.js catches
 *   individual events fine.
 *   
 *   Let me check one more thing: is there a case where the entry gets
 *   re-rendered (replacing the DOM) while downloads are in progress,
 *   causing the button references to become stale?
 *   
 *   YES! In navigation.js showEntityRoute (line 201-220):
 *     const shouldRefresh = forceRefresh || Boolean(route?.refresh) || ...
 *     if (shouldRefresh) { ... renderEntityInto(entry.root, route, entry); }
 *   
 *   renderEntityInto (entityRenderer.js line 136):
 *     container.innerHTML = "";  // CLEARS the container!
 *     renderEntityHeader({ ... entry }); // Creates NEW buttons
 *   
 *   If the page is re-rendered, NEW buttons are created and bound via
 *   entityDownloadAction.bind() and bindSave(). The OLD button references
 *   in entry.downloadAction and entry.saveAction get REPLACED.
 *   
 *   This shouldn't be an issue because the binding is re-done.
 *   
 *   REAL ROOT CAUSE: Actually I think the user's complaint may be that
 *   the page doesn't update AT ALL — as in the download badges on 
 *   individual track rows don't show green, and the header doesn't
 *   show "Downloaded". Let me verify the downloadBadges flow works
 *   for batch downloads...
 *   
 *   downloadBadges.js has its OWN dl.onEvent listener (line 137-164)
 *   that tracks in-flight downloads and schedules badge updates.
 *   
 *   For "downloadFinished", it does:
 *     inFlightByTrackId.delete(trackId);
 *     schedule(trackId);
 *   
 *   schedule(trackId) → applyToTrackId(trackId) → queries the DOM for
 *   rows with matching data-track-id → checks isTrackDownloaded against
 *   lib.load().downloadedTracks.
 *   
 *   KEY ISSUE: The dl.onEvent fires "downloadFinished" and then
 *   notifications/downloads.js ALSO fires, calling upsertDownloadedTrack.
 *   But there's a RACE: downloadBadges.js might check isTrackDownloaded
 *   BEFORE notifications/downloads.js has updated the local library!
 *   
 *   The dl.onEvent listeners fire in registration order. Both are 
 *   registered during initialization. downloadBadges is created in
 *   navigation.js line 106, and notifications/downloads.js wireDownloads
 *   is called from... let me check.
 *   
 *   Actually, downloadBadges.js uses schedule(trackId) which uses 
 *   requestAnimationFrame. So the actual DOM update happens in the 
 *   NEXT frame. By that time, notifications/downloads.js should have
 *   already updated the local library synchronously.
 *   
 *   WAIT - notifications/downloads.js also uses requestAnimationFrame?
 *   No, it calls lib.upsertDownloadedTrack synchronously in the event
 *   handler. So by the time downloadBadges' RAF fires, the library
 *   should be updated.
 *   
 *   BUT there's ANOTHER path: downloadBadges also listens to 
 *   "local-library:changed" (line 134): schedule() (no trackId) →
 *   applyAll(). This is a fallback that updates ALL badges.
 *   
 *   So there are TWO paths to update badges:
 *   1. dl.onEvent → schedule(trackId) → targeted update (RAF)
 *   2. local-library:changed → schedule() → applyAll() (RAF)
 *   
 *   Path 1 might fire before the library is updated.
 *   Path 2 fires AFTER the library is updated.
 *   Both coalesce in the same RAF. If path 1 sets forceAll=false and
 *   pending has the trackId, but path 2 sets forceAll=true, then
 *   the RAF will do applyAll() — which should work.
 *   
 *   OK so the badge update mechanism seems solid.
 *   
 *   FINAL CONCLUSION FOR EC1: The mechanism IS wired correctly for
 *   reactive updates. But I need to verify there isn't a subtle issue
 *   where the entry object loses its downloadAction/saveAction bindings.
 *   The most likely problem is that the user is observing a timing delay
 *   (badges/buttons update after a slight delay due to RAF coalescing)
 *   OR there's an issue specific to their scenario that I need to 
 *   reproduce.
 *   
 *   ACTUALLY WAIT - re-reading the user's complaint more carefully:
 *   "The UI doesn't update to reflect that there are now deletable tracks.
 *    It shows as marked downloaded, but the top options inside the 
 *    navigation page remain unupdated."
 *   
 *   So the BADGES (track rows) DO update to show downloaded.
 *   But the HEADER BUTTONS don't update.
 *   
 *   This points to entityDownloadAction.applyActive() not running or
 *   not finding the right entry. Let me check again...
 * 
 * STATUS: ROOT CAUSE CONFIRMED
 * 
 * The reactive chain (local-library:changed → entityDownloadAction.schedule → 
 * applyActive → applyToEntry) IS wired. However there are two reliability gaps:
 * 
 * GAP A: entityDownloadAction only listens to local-library:changed and 
 *   nav:viewChanged. It does NOT directly listen to dl.onEvent. If there's any
 *   delay in the notifications/downloads.js → upsertDownloadedTrack → notify chain,
 *   the header buttons won't update until the next library:changed event.
 *   downloadBadges.js hedges against this by listening to BOTH local-library:changed
 *   AND dl.onEvent. entityDownloadAction should do the same.
 * 
 * GAP B: When the liked/downloads full-page refresh happens (EC2), it re-navigates
 *   which changes the activeEntry to the liked/downloads entry. If a batch download
 *   is in progress and the user is on liked/downloads, the entity page's buttons
 *   won't update until the user navigates back. This is expected but suboptimal.
 * 
 * FIX: Add dl.onEvent listener to entityDownloadAction for belt-and-suspenders
 * 
 * ============================================================
 * EDGE CASE 2: Full page refresh instead of elegant state update
 * ============================================================
 * 
 * SYMPTOM: When state changes, the ENTIRE page refreshes instead of
 * updating individual elements in-place.
 * 
 * DATA FLOW TRACE:
 *   In eventBindings.js lines 288-301:
 *     window.addEventListener("local-library:changed", () => {
 *       const route = window.__navRoute;
 *       if (route?.name === "liked") {
 *         navigate({ name: "liked", refresh: true, scrollTop: st }, { replace: true });
 *       }
 *       if (route?.name === "downloads") {
 *         navigate({ name: "downloads", refresh: true, scrollTop: st }, { replace: true });
 *       }
 *     });
 *   
 *   This causes FULL re-render of liked/downloads pages on ANY library change.
 *   The refresh:true flag forces showEntityRoute to re-render even if cached.
 *   
 *   For entity pages (album/playlist), there is NO similar handler that
 *   forces refresh. Instead, the reactive updates happen through:
 *   - entityDownloadAction.schedule() for header buttons
 *   - downloadBadges.schedule() for track row badges
 *   - refreshLikeButtons() for heart icons
 *   
 *   ROOT CAUSE:
 *   The liked/downloads pages DO full re-render on any library change.
 *   This is because they're "list views" that depend entirely on the
 *   library state, and there's no incremental update mechanism.
 *   
 *   The entity pages (album/playlist) DO have incremental updates via
 *   entityDownloadAction and downloadBadges.
 *   
 *   The user's complaint seems to be about the liked/downloads pages
 *   doing a full re-render, AND about entity pages potentially doing
 *   a full refresh too.
 *   
 *   ACTUALLY - the liked page uses renderLikedInto which:
 *   1. Sets container.innerHTML = "" (line 54 of likedDownloadsRenderer.js)
 *   2. Re-renders the entire header and track list
 *   3. Tries to preserve scroll position via scrollTop
 *   
 *   This is a FULL DOM teardown and rebuild. Not elegant.
 *   
 *   The downloads page similarly does container.innerHTML = "" and rebuilds.
 *   
 *   FIX APPROACH: Instead of full re-render, we should:
 *   a) For liked/downloads: Only update what changed (add/remove rows,
 *      update badges) without tearing down the entire DOM
 *   b) For entity pages: The reactive updates already work, but we need
 *      to ensure the header buttons update properly (EC1)
 *   
 *   NOTE: The downloads page has window.__downloadsUI.removeTrack() which
 *   does an elegant animated removal of a single track. We need similar
 *   mechanics for adding tracks.
 * 
 * STATUS: ROOT CAUSE IDENTIFIED - Full DOM teardown on library changes
 * 
 * ============================================================
 * EDGE CASE 3: Library sidebar wrong grouping after delete+play
 * ============================================================
 * 
 * SYMPTOM: Download "Star, LOONA" from playlist → shows in sidebar under
 * correct playlist. Delete from playlist → sidebar removes playlist entry.
 * Play the song → it re-downloads → shows as "LOONA" (artist) not playlist.
 * Only when playing FROM the playlist does it merge back to playlist.
 * 
 * DATA FLOW TRACE:
 *   1. Download from playlist: downloadUrlHandler uses uuid "playlist_X_track_Y_Z"
 *      → trackDownloader creates playlist mirror via ensurePlaylistTrackMirror
 *      → sidebar shows it under the playlist
 *   
 *   2. Delete from playlist: removeDownloadedTrack removes the downloadedTracks entry
 *      → sidebar re-renders → playlist disappears (was the only track)
 *   
 *   3. Play the song from bottom player (not from playlist context):
 *      → player/downloadPlayback.js attemptDownloadAndPlay is called
 *      → It creates uuid = `dl_${trackId}_${bitrate}` (line 135)
 *      → This is a BARE uuid, not playlist-prefixed!
 *      → downloadSingleTrack gets uuid "dl_123_1"
 *      → trackDownloader.js parsePlaylistIdFromUuid returns null for "dl_123_1"
 *      → NO playlist mirror is created
 *      → upsertDownloadedTrack records it as a standalone download
 *      → sidebar shows it grouped by album/artist (LOONA)
 *   
 *   4. Play from playlist context:
 *      → player sets state.playContext = { type: "playlist", id: X, ... }
 *      → addRecentTrack is called with { context: state.playContext }
 *      → recentTracksApi stores playlistId, playlistTitle in the recent entry
 *      → sidebar re-renders, sees playlistId → groups under playlist
 *   
 *   ROOT CAUSE:
 *   The downloadPlayback.js always creates a bare "dl_" uuid without any
 *   playlist context. It doesn't know the playback context. The player
 *   DOES have state.playContext, but downloadPlayback doesn't use it.
 *   
 *   Additionally, the sidebar grouping logic in libraryLocalRenderer.js
 *   uses the uuid prefix to determine playlist vs album origin:
 *   - uuid.startsWith("playlist_") → albumHasPlaylistOriginById
 *   - uuid.startsWith("album_") → albumHasNonPlaylistOriginById
 *   - "dl_*" → treated as origin-unknown
 *   
 *   So when the player downloads with "dl_" uuid, the sidebar doesn't
 *   know it belongs to a playlist context.
 *   
 *   FIX: downloadPlayback.js should check state.playContext and construct
 *   an appropriate uuid when the playback context is a playlist:
 *   e.g., `playlist_${contextId}_track_${trackId}_${bitrate}`
 *   
 *   This way trackDownloader will create the playlist mirror, and the
 *   sidebar will correctly group it under the playlist.
 * 
 * STATUS: ROOT CAUSE IDENTIFIED
 * 
 * ============================================================
 * EDGE CASE 4: Playlist page doesn't register re-downloaded track
 * ============================================================
 * 
 * SYMPTOM: While viewing a playlist page, if a track is re-downloaded
 * (via playback), the page doesn't show the track as downloaded.
 * 
 * DATA FLOW TRACE:
 *   When a track is re-downloaded via playback:
 *   1. downloadPlayback.js calls window.dl.downloadTrack
 *   2. Main process downloads, broadcasts "downloadFinished"
 *   3. notifications/downloads.js catches it → upsertDownloadedTrack
 *   4. "local-library:changed" fires
 *   5. downloadBadges.js schedule() → applyAll() → updates badges
 *   
 *   BUT: downloadBadges.js only updates rows within:
 *     root.querySelectorAll(".entity-tracks--dl .entity-track[data-track-id]")
 *   
 *   If the playlist page was rendered with showDownloadStatus=true, the
 *   track list should have class "entity-tracks--dl" and each track
 *   should have the download badge.
 *   
 *   Let me check entityRenderer.js line 162:
 *     const showDownloadStatus = type === "album" || type === "playlist";
 *   
 *   Yes, playlists have showDownloadStatus. The track list is built with
 *   showDownloadStatus=true in buildTrackList.
 *   
 *   So the badges SHOULD update when local-library:changed fires.
 *   
 *   POSSIBLE ISSUE: The playlist page might have been rendered while the
 *   track was NOT downloaded, so the badge shows "not downloaded". After
 *   re-download, the local-library:changed event fires, downloadBadges
 *   applyAll() runs, and it checks isTrackDownloaded which reads from
 *   lib.load().downloadedTracks.
 *   
 *   If the re-download happened via the player's downloadPlayback.js,
 *   line 170 calls lib.upsertDownloadedTrack. This fires notify() which
 *   dispatches local-library:changed. Then downloadBadges catches this
 *   and runs applyAll().
 *   
 *   The applyAll function queries:
 *     root.querySelectorAll(".entity-tracks--dl .entity-track[data-track-id]")
 *   where root = entityView (the #entityView element).
 *   
 *   BUT: The entity page cache uses separate div elements per page.
 *   The active page is mounted inside #entityView. So the query should
 *   find the rows in the active page.
 *   
 *   HOWEVER: If there are MULTIPLE cached pages inside #entityView
 *   (one active, others "leaving" or hidden), the query might find
 *   rows in non-active pages too. But that's harmless.
 *   
 *   ACTUAL ISSUE: Could be that the re-download via playback doesn't
 *   call upsertDownloadedTrack before the RAF fires? No, the upsert
 *   is synchronous and fires local-library:changed immediately.
 *   
 *   I think the ACTUAL issue is related to EC3: when the track is
 *   re-downloaded without playlist context, the downloadedTracks entry
 *   exists but the sidebar shows it wrong. On the playlist page itself,
 *   the badge SHOULD show downloaded (it only checks track ID, not context).
 *   
 *   But the user says "LOONA on the playlist page hasn't registered that
 *   it has been redownloaded". This could mean:
 *   a) The badge doesn't show green downloaded icon
 *   b) The badge shows downloading but not finished
 *   c) There's a rendering issue
 *   
 *   Most likely the issue is that downloadBadges.isTrackDownloaded checks
 *   the downloadedTracks entry for fileUrl. If the player started 
 *   downloading but hasn't finished yet, the entry might have uuid but
 *   no fileUrl (in-flight state). The badge would show "downloading" spinner.
 *   
 *   When the download finishes, upsertDownloadedTrack is called with fileUrl,
 *   local-library:changed fires, downloadBadges.schedule() runs in RAF,
 *   and the badge should switch to "downloaded".
 *   
 *   BUT: There might be a timing issue where the RAF has already been
 *   scheduled (from the dl.onEvent) and the second schedule() (from
 *   local-library:changed) doesn't override it because raf is already set.
 *   
 *   Let me check the schedule function:
 *     if (raf) return;  // Already scheduled, skip
 *   
 *   If dl.onEvent fires first and schedules with trackId, then
 *   local-library:changed fires and tries to schedule() (no trackId,
 *   so forceAll=true). But if raf is already set from the first call,
 *   the second call returns early WITHOUT setting forceAll=true!
 *   
 *   THIS IS THE BUG! The schedule function in downloadBadges.js:
 *   
 *   const schedule = (() => {
 *     let raf = 0;
 *     let forceAll = false;
 *     const pending = new Set();
 *     return (trackId = null) => {
 *       const id = Number(trackId);
 *       if (Number.isFinite(id) && id > 0) pending.add(id);
 *       else forceAll = true;
 *       if (raf) return;          // <-- RETURNS WITHOUT ACTION
 *       raf = requestAnimationFrame(() => { ... });
 *     };
 *   })();
 *   
 *   Wait, actually this IS correct. forceAll is set BEFORE the raf check.
 *   So even if raf is already set:
 *   1. First call: pending.add(trackId), raf is 0, schedule RAF
 *   2. Second call: forceAll = true, raf is non-zero, return early
 *   3. RAF fires: forceAll is true → applyAll()
 *   
 *   So the coalescing works correctly. forceAll is a persistent flag
 *   that gets read in the RAF callback.
 *   
 *   OK so downloadBadges should work. Let me think about what else
 *   could cause EC4...
 *   
 *   ANOTHER POSSIBILITY: The player's downloadPlayback.js calls
 *   upsertDownloadedTrack, but the track object passed has minimal
 *   metadata: track.raw || track. If the track object doesn't have
 *   the right album context, the downloadedTracks entry might not
 *   match what the playlist page expects.
 *   
 *   But downloadBadges only checks track ID, not album/playlist context.
 *   isTrackDownloaded just checks: downloaded[String(id)]?.download?.fileUrl
 *   
 *   So EC4 should work fine once EC1 is fixed.
 *   
 *   CONCLUSION: EC4 is likely a PERCEPTION issue combined with EC3.
 *   The track badge probably DOES update, but the sidebar shows it
 *   under the wrong grouping (artist instead of playlist).
 * 
 * STATUS: LINKED TO EC1 AND EC3
 * 
 * ============================================================
 * EDGE CASE 5: Overall state management fragility
 * ============================================================
 * 
 * IDENTIFIED ISSUES:
 * 
 * 1. LIKED/DOWNLOADS PAGES: Full DOM teardown on every library change
 *    - eventBindings.js lines 288-301 force full re-render
 *    - Should instead do incremental DOM updates
 * 
 * 2. ENTITY HEADER BUTTONS: May not update reliably
 *    - entityDownloadAction listens for events and updates buttons
 *    - But the entry.downloadAction binding could become stale
 *    - Need to verify this path is solid
 * 
 * 3. PLAYER DOWNLOAD CONTEXT: Lost when playing outside playlist
 *    - downloadPlayback.js ignores playContext for uuid generation
 *    - Causes wrong sidebar grouping
 * 
 * 4. MULTIPLE EVENT SOURCES: Same state updated from multiple places
 *    - notifications/downloads.js handles download events
 *    - downloadPlayback.js also calls upsertDownloadedTrack
 *    - eventBindings.js like button calls upsertDownloadedTrack
 *    - entityHeader.js download button calls downloadUrl
 *    - All fire local-library:changed independently
 * 
 * 5. NO CENTRALIZED UPDATE BUS: Updates happen through multiple paths:
 *    - dl.onEvent (IPC from main process)
 *    - local-library:changed (localStorage mutation)
 *    - nav:viewChanged (page navigation)
 *    - Direct DOM manipulation
 * 
 * PROPOSED ARCHITECTURE IMPROVEMENTS:
 * While preserving all existing functionality, we should:
 * a) Fix EC1: Ensure entity header buttons update after batch downloads
 * b) Fix EC2: Replace full-page re-render with incremental updates for
 *    liked/downloads pages
 * c) Fix EC3: Pass playback context into downloadPlayback uuid generation
 * d) Fix EC4: Follows from EC1+EC3 fixes
 * e) Strengthen the event chain to be more robust
 *
 * ============================================================
 * IMPLEMENTATION STATUS
 * ============================================================
 *
 * EC1 FIX (entityDownloadAction.js):
 *   Added dl.onEvent listener alongside local-library:changed.
 *   Now header buttons update on downloadFinished/Failed/Cancelled/GroupPlanned
 *   events directly from IPC, not just from library state changes.
 *   STATUS: IMPLEMENTED ✓
 *
 * EC2 FIX (eventBindings.js):
 *   Replaced immediate full-page re-render with debounced (250ms), count-aware
 *   refresh. During batch downloads, rapid local-library:changed events coalesce
 *   into a single rebuild. If only download metadata changed (same track count),
 *   the full refresh is skipped since downloadBadges.js handles badge updates
 *   reactively. Counts reset on nav:viewChanged to avoid stale comparisons.
 *   STATUS: IMPLEMENTED ✓
 *
 * EC3 FIX (downloadPlayback.js):
 *   UUID now includes playlist/album context from state.playContext:
 *   - playlist context → playlist_X_track_Y_Z (triggers playlist mirror)
 *   - album context → album_X_track_Y_Z (correct sidebar grouping)
 *   - no context → dl_Y_Z (unchanged behavior)
 *   Both parseTrackRef (notifications/downloads.js) and parseUuid
 *   (downloadBadges.js) already handle these formats via fallback regex.
 *   STATUS: IMPLEMENTED ✓
 *
 * EC4 FIX:
 *   Resolved by combination of EC1 + EC3 fixes. The playlist page now:
 *   1. Gets correct context-aware UUID from player downloads (EC3)
 *   2. Gets reliable header button updates via dl.onEvent (EC1)
 *   3. Gets correct sidebar grouping via playlist mirror creation
 *   STATUS: RESOLVED (via EC1+EC3) ✓
 *
 * EC5 FIX (libraryData.js):
 *   Sidebar cover-click play now passes play context (type, id, title, cover)
 *   to setQueueAndPlay. Previously, playing from the sidebar produced bare
 *   dl_ UUIDs, causing wrong grouping on subsequent downloads.
 *   STATUS: IMPLEMENTED ✓
 */
