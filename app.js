import { wireChips, wirePlatformClasses, wireRanges } from "./renderer/platform.js";
import { wireAccountMenu } from "./renderer/accountMenu.js";
import { wireCarousels } from "./renderer/carousels.js";
import { wireDeezerSections } from "./renderer/deezerSections.js";
import { wireModal } from "./renderer/modal.js";
import { wireNavigation, wireNowPlayingHighlights } from "./renderer/navigation.js";
import { wireDownloads, wireNotifications } from "./renderer/notifications.js";
import { createPlayerController } from "./renderer/player.js";
import { wireContextMenus } from "./renderer/contextMenu.js";
import { wireLibraryHealthCheck } from "./renderer/libraryHealth.js";
import {
  wireLibraryData,
  wireLibraryFilters,
  wireLibrarySelection,
  wireQuickCards,
  wireSidebarCollapse,
  wireSidebarResize,
} from "./renderer/sidebar.js";

wirePlatformClasses();
wireRanges();
wireChips();
wireModal();
wireCarousels();

window.__player = createPlayerController();

wireQuickCards();
wireLibrarySelection();
wireLibraryFilters();
wireLibraryData();
wireSidebarResize();
wireSidebarCollapse();

wireAccountMenu();
wireNavigation();
wireNowPlayingHighlights();

wireNotifications();
wireDownloads();
wireLibraryHealthCheck();
wireDeezerSections();
wireContextMenus();
