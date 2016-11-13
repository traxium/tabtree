/*
 * This file is part of Tab Tree,
 * Copyright (C) 2015-2016 Sergey Zelentsov <crayfishexterminator@gmail.com>
 */

'use strict';
/* jshint moz:true */
/* global Components, CustomizableUI, Services, SessionStore, APP_SHUTDOWN, ShortcutUtils, NavBarHeight, AddonManager */

//const {classes: Cc, interfaces: Ci, utils: Cu} = Components; // WebStorm inspector doesn't understand destructuring assignment
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/ShortcutUtils.jsm");
Cu.import("resource:///modules/CustomizableUI.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
var ssHack = Cu.import("resource:///modules/sessionstore/SessionStore.jsm");
var ssOrig;
const ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
var stringBundle = Services.strings.createBundle('chrome://tabtree/locale/global.properties?' + Math.random()); // Randomize URI to work around bug 719376
const { require } = Cu.import("resource://gre/modules/commonjs/toolkit/require.js", {});
var keyboardUtils = null;
try {
	keyboardUtils = require("sdk/keyboard/utils");
}catch(e) {
	// low level SDK API not available
}

var prefsObserver;
var defaultThemeAddonListener;
var tabHeightGlobal = {value: -1, uri: null};
var tabNumbers = false;

const TT_POS_LEFT = 0;
const TT_POS_RIGHT = 1;
const TT_POS_SB_TOP = 2;
const TT_POS_SB_BOT = 3;

const TT_COL_TITLE = 0;
const TT_COL_OVERLAY = 1;
const TT_COL_CLOSE = 2;
//noinspection JSUnusedLocalSymbols
const TT_COL_SCROLLBAR = 3; // Keep this one at the end, it has CSS to keep other columns from being hidden by the scrollbar

// Test keys either using low level SDK API if available, or without (which does not handle many layouts properly)
function keyboardHelper(keyboardEvent) {
	return {
		keyboardEvent: keyboardEvent,
		translatedKey: keyboardUtils ? keyboardUtils.getKeyForCode(keyboardEvent.keyCode) : null,
		testCode: function(code, translation) {
			return keyboardUtils ? this.translatedKey === translation : keyboardEvent.code === code;
		},
		testKey: function(key, translation) {
			return keyboardUtils ? this.translatedKey === translation : keyboardEvent.key === key;
		}
	};
}

//noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
function startup(data, reason)
{
	let uri = Services.io.newURI("chrome://tabtree/skin/tt-tree.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	uri = Services.io.newURI("chrome://tabtree/skin/tt-other.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	uri = Services.io.newURI("chrome://tabtree/skin/tt-auto-hide.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	uri = Services.io.newURI("chrome://tabtree/skin/tt-navbar-private.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	uri = Services.io.newURI("chrome://tabtree/skin/tt-options.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);

	//	// Why do we use Proxy here? Let's see the chain how SS works:
	//	// <window onload="gBrowserInit.onLoad()" /> ->
	//	// -> Services.obs.notifyObservers(window, "browser-window-before-show", ""); ->
	//	// -> SessionStore.jsm ->
	//	// -> OBSERVING.forEach(function(aTopic) { Services.obs.addObserver(this, aTopic, true); }, this); ->
	//	// -> case "browser-window-before-show": this.onBeforeBrowserWindowShown(aSubject); ->
	//	// -> SessionStoreInternal.onLoad(aWindow); ->
	//	// (1) -> Services.obs.notifyObservers(null, NOTIFY_WINDOWS_RESTORED, "");
	//	// (2) -> or just end
	//  //  UPD: Firefox 41+ splits SessionStoreInternal.onLoad in two - onLoad and initializeWindow
	
	//  // Here we dispatch our new event 'tt-TabsLoad'
	if (ssHack.SessionStoreInternal.initializeWindow) { // Fix for Firefox 41+
		ssOrig = ssHack.SessionStoreInternal.initializeWindow;
		ssHack.SessionStoreInternal.initializeWindow = new Proxy(ssHack.SessionStoreInternal.initializeWindow, {
			apply: function (target, thisArg, argumentsList) {
				target.apply(thisArg, argumentsList); // returns nothing
				let aWindow = argumentsList[0];
				//noinspection JSClosureCompilerSyntax
				let event = new Event('tt-TabsLoad'); // we just added our event after this function is executed
				aWindow.dispatchEvent(event);
			}
		});
	} else { // to support Firefox before version 41
		ssOrig = ssHack.SessionStoreInternal.onLoad;
		ssHack.SessionStoreInternal.onLoad = new Proxy(ssHack.SessionStoreInternal.onLoad, {
			apply: function (target, thisArg, argumentsList) {
				target.apply(thisArg, argumentsList); // returns nothing
				let aWindow = argumentsList[0];
				//noinspection JSClosureCompilerSyntax
				let event = new Event('tt-TabsLoad'); // we just added our event after this function is executed
				aWindow.dispatchEvent(event);
			}
		});
	}

	// I leave it here just in case. It also works, but the upper version is better tested.
	//ssHack.SessionStoreInternal._setWindowStateBusyValue = new Proxy(ssHack.SessionStoreInternal._setWindowStateBusyValue, {
	//	apply: function (target, thisArg, argumentsList) {
	//		target.apply(thisArg, argumentsList); // returns nothing
	//		let aWindow = argumentsList[0];
	//		let aValue = argumentsList[1];
	//		if (!aValue) { //noinspection JSClosureCompilerSyntax
	//			let event = new Event('tt-TabsLoad'); // we just added our event after this function is executed
	//			aWindow.dispatchEvent(event);
	//		}
	//	}
	//});

	ssHack.SessionStoreInternal.ttOrigOfUndoCloseTab = ssHack.SessionStoreInternal.undoCloseTab;
	ssHack.SessionStoreInternal.undoCloseTab = new Proxy(ssHack.SessionStoreInternal.undoCloseTab, {
		apply: function (target, thisArg, argumentsList) {
			let aWindow = argumentsList[0];
			aWindow.ttIsRestoringTab = true;
			return target.apply(thisArg, argumentsList); // returns a tab
		}
	}); // restored in shutdown()
	
	try { // 1.4.5 -> 1.4.6
		if (Services.prefs.getBoolPref("extensions.tabtree.dblclick")) {
			Services.prefs.deleteBranch("extensions.tabtree.dblclick");
			Services.prefs.setIntPref("extensions.tabtree.dblclick", 1)
		} else {
			Services.prefs.deleteBranch("extensions.tabtree.dblclick");
			Services.prefs.setIntPref("extensions.tabtree.dblclick", 0)
		}
	} catch (e) {
	} // should be deleted when 1.4.5 isn't in use anymore

	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.treelines', true); // setting default pref
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.highlight-unloaded-tabs', 0); // setting default pref
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.dblclick', 0); // setting default pref // 0 - No action, 1 - Close tab, 2 - Pin tab
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.middle-click-tabbar', false); // #36 (Middle click on empty space to open a new tab)
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.delay', 0); // setting default pref
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.position', 1); // setting default pref // 0 - Left, 1 - Right
	// 0 - Top, 1 - Bottom (before "New tab" button), 2 - Bottom (after "New tab" button):
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.search-position', 0);
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.search-autohide', false); // setting default pref
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.show-default-tabs', false); // hidden pref for test purposes
	// 0 - default, 1 - flst, 2 - the closest tab in the tree (first child -> sibling below -> sibling above -> parent), 3 - the previous tab
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.after-close', 1); //focus closest tab in tree after closing a current tab
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.highlight-unread-tabs', false);
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.new-tab-button', true);
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.close-tab-buttons', true);
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.max-indent', -1); // -1 means no maximum indent level
	// 0 - "without Shift - ordinary scrolling, with Shift - changing selected tab"
	// 1 - "without Shift - changing selected tab, with Shift - ordinary scrolling"
	// 2 - "always ordinary scrolling" 3 - "always changing selected tab":
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.wheel', 0);
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.search-jump', false); // jump to the first search match
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.search-jump-min-chars', 4); // min chars to jump
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.insertRelatedAfterCurrent', false); // #19 // false - Bottom, true - Top
	// 0 - default, 1 - try to mimic Firefox theme, 2 - dark
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.theme', 1); // #35 #50
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.prefix-context-menu-items', false); // #60 (Garbage in menu items)
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.tab-height', -1); // #67 [Feature] Provide a way to change the items height
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.tab-flip', true);
	Services.prefs.getDefaultBranch(null).setCharPref('extensions.tabtree.auto-hide-key', 'F8');
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.auto-hide-when-fullscreen', true); // #18 hold the tab tree in full screen mode
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.auto-hide-when-maximized', false); // #40 #80
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.auto-hide-when-normal', false); // #40 #80
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.auto-hide-when-only-one-tab', true); // #31
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.tab-numbers', false); // #90 (Show tab numbers in tab titles) 

	// migration code :
	try {
		Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-fullscreen", !Services.prefs.getBoolPref("extensions.tabtree.fullscreen-show"));
		Services.prefs.deleteBranch("extensions.tabtree.fullscreen-show");
		Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-only-one-tab", Services.prefs.getBoolPref("extensions.tabtree.hide-tabtree-with-one-tab"));
		Services.prefs.deleteBranch("extensions.tabtree.hide-tabtree-with-one-tab");
	} catch (e) {
	}
	// - end migration code // don't forget to delete when v1.4.4 or older aren't in use anymore

	let uriTabsToolbar = Services.io.newURI("chrome://tabtree/skin/tt-TabsToolbar.css", null, null);
	if (!Services.prefs.getBoolPref('extensions.tabtree.show-default-tabs')) {
		sss.loadAndRegisterSheet(uriTabsToolbar, sss.AUTHOR_SHEET);
	}

	//noinspection JSUnusedGlobalSymbols
	Services.prefs.addObserver('extensions.tabtree.', (prefsObserver = {
		observe: function(subject, topic, data) {
			if (topic == 'nsPref:changed') {
				switch (data) {
					case 'extensions.tabtree.show-default-tabs':
						if (Services.prefs.getBoolPref('extensions.tabtree.show-default-tabs')) {
							sss.unregisterSheet(uriTabsToolbar, sss.AUTHOR_SHEET);
						} else {
							sss.loadAndRegisterSheet(uriTabsToolbar, sss.AUTHOR_SHEET);
						}
						break;
					case "extensions.tabtree.theme":
						// Get default theme:
						AddonManager.getAddonByID("{972ce4c6-7e08-4474-a285-3208198ce6fd}", (x) => {
							[
								"chrome://tabtree/skin/tt-theme-mimic.css",
								"chrome://tabtree/skin/tt-theme-dark.css",
								"chrome://tabtree/skin/tt-theme-default.css",
								"chrome://tabtree/skin/tt-theme-osx.css",
							].forEach((x) => {
								let uri = Services.io.newURI(x, null, null);
								if (sss.sheetRegistered(uri, sss.AUTHOR_SHEET)) {
									sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
								}
							});
							switch (Services.prefs.getIntPref("extensions.tabtree.theme")) {
								case 1: // try to mimic the current Firefox theme
									if (x.userDisabled) { // if the default Firefox theme is disabled then load mimic CSS
										sss.loadAndRegisterSheet(Services.io.newURI("chrome://tabtree/skin/tt-theme-mimic.css", null, null), sss.AUTHOR_SHEET);
									} else { // if the default Firefox theme is enabled then load default CSS
										sss.loadAndRegisterSheet(Services.io.newURI("chrome://tabtree/skin/tt-theme-default.css", null, null), sss.AUTHOR_SHEET);
										if (Services.appinfo.OS == "Darwin") {
											sss.loadAndRegisterSheet(Services.io.newURI("chrome://tabtree/skin/tt-theme-osx.css", null, null), sss.AUTHOR_SHEET);
										}
									}
									break;
								case 2: // force the dark theme
									sss.loadAndRegisterSheet(Services.io.newURI("chrome://tabtree/skin/tt-theme-dark.css", null, null), sss.AUTHOR_SHEET);
									break;
								default:
									sss.loadAndRegisterSheet(Services.io.newURI("chrome://tabtree/skin/tt-theme-default.css", null, null), sss.AUTHOR_SHEET);
									if (Services.appinfo.OS == "Darwin") {
										sss.loadAndRegisterSheet(Services.io.newURI("chrome://tabtree/skin/tt-theme-osx.css", null, null), sss.AUTHOR_SHEET);
									}
							}

							// Determine ID of the current theme:
							AddonManager.getAddonsByTypes(["theme"], (themes) => {
								for (let theme of themes) {
									if (!theme.userDisabled) {
										Services.obs.notifyObservers(null, "tt-theme-changed", theme.id);
										break;
									}
								}
							});
						});
				}
			}
		}
	}), false); // don't forget to remove // there must be only one pref observer for all Firefox windows for sss prefs
	prefsObserver.observe(null, 'nsPref:changed', 'extensions.tabtree.theme');
	// Refresh the Tab Tree theme when the Firefox theme is changed from/to the default theme:
	AddonManager.addAddonListener((defaultThemeAddonListener = {
		onEnabled(a) {
			if (a.id === "{972ce4c6-7e08-4474-a285-3208198ce6fd}") {
				prefsObserver.observe(null, 'nsPref:changed', 'extensions.tabtree.theme');
			}
			if (a.type === "theme") {
				Services.obs.notifyObservers(null, "tt-theme-changed", a.id);
			}
		},
		onDisabled(a) {
			if (a.id === "{972ce4c6-7e08-4474-a285-3208198ce6fd}") {
				prefsObserver.observe(null, 'nsPref:changed', 'extensions.tabtree.theme');
			}
		},
	}));

	Cu.import(data.resourceURI.spec + "modules/NavBarHeight/NavBarHeight.jsm");
	NavBarHeight.data = data;
	NavBarHeight.packageName = "tabtree";
	NavBarHeight.init();
	
	windowListener.register();
}

//noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
function shutdown(data, reason)
{
	if (reason == APP_SHUTDOWN) return;

	[
		"chrome://tabtree/skin/tt-tree.css",
		"chrome://tabtree/skin/tt-theme-mimic.css",
		"chrome://tabtree/skin/tt-theme-dark.css",
		"chrome://tabtree/skin/tt-theme-default.css",
		"chrome://tabtree/skin/tt-theme-osx.css",
		"chrome://tabtree/skin/tt-other.css",
		"chrome://tabtree/skin/tt-auto-hide.css",
		"chrome://tabtree/skin/tt-navbar-private.css",
		"chrome://tabtree/skin/tt-options.css",
		"chrome://tabtree/skin/tt-TabsToolbar.css",
	].forEach(function(x) {
		let uri = Services.io.newURI(x, null, null);
		if (sss.sheetRegistered(uri, sss.AUTHOR_SHEET)) {
			sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
		}
	});
	if (tabHeightGlobal.uri && sss.sheetRegistered(tabHeightGlobal.uri, sss.AUTHOR_SHEET)) {
		sss.unregisterSheet(tabHeightGlobal.uri, sss.AUTHOR_SHEET);
	}

	if (ssHack.SessionStoreInternal.initializeWindow) { // Fix for Firefox 41+
		ssHack.SessionStoreInternal.initializeWindow = ssOrig;
	} else { // to support Firefox before version 41
		ssHack.SessionStoreInternal.onLoad = ssOrig;
	}
	ssHack.SessionStoreInternal.undoCloseTab = ssHack.SessionStoreInternal.ttOrigOfUndoCloseTab;

	Services.prefs.removeObserver('extensions.tabtree.', prefsObserver); // sss related prefs
	AddonManager.removeAddonListener(defaultThemeAddonListener);

	if (ss.getGlobalValue('tt-saved-widgets')) {
		let save = JSON.parse(ss.getGlobalValue('tt-saved-widgets'));
		save.forEach(function (x) {
			try {
				CustomizableUI.addWidgetToArea(x, 'TabsToolbar');
			} catch (e) {
			}
		});
		ss.deleteGlobalValue('tt-saved-widgets');
	}
	
	NavBarHeight.uninit();
	Cu.unload(data.resourceURI.spec + "modules/NavBarHeight/NavBarHeight.jsm");
	
	windowListener.unregister();
}

//noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
function install(aData, aReason) { }
//noinspection JSUnusedGlobalSymbols,JSUnusedLocalSymbols
function uninstall(aData, aReason) { }

//noinspection JSUnusedGlobalSymbols
var windowListener = {
	
	onOpenWindow: function (aXULWindow) {
		// In Gecko 7.0 nsIDOMWindow2 has been merged into nsIDOMWindow interface.
		// In Gecko 8.0 nsIDOMStorageWindow and nsIDOMWindowInternal have been merged into nsIDOMWindow interface.
		// Since ≈FF50 "Use of nsIDOMWindowInternal is deprecated. Use nsIDOMWindow instead."
		let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		aDOMWindow.addEventListener('tt-TabsLoad', function onTabsLoad(event) {
			aDOMWindow.removeEventListener('tt-TabsLoad', onTabsLoad, false);
			
			windowListener.loadIntoWindow(aDOMWindow);
		}, false);
	},
	
	onCloseWindow: function (aXULWindow) {
		// In Gecko 7.0 nsIDOMWindow2 has been merged into nsIDOMWindow interface.
		// In Gecko 8.0 nsIDOMStorageWindow and nsIDOMWindowInternal have been merged into nsIDOMWindow interface.
		// Since ≈FF50 "Use of nsIDOMWindowInternal is deprecated. Use nsIDOMWindow instead."
		let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		let sidebar = aDOMWindow.document.querySelector('#tt-sidebar');
		ss.setWindowValue(aDOMWindow, 'tt-width', sidebar.width); // Remember the width of 'tt-sidebar'
		ss.setWindowValue(aDOMWindow, 'tt-height', sidebar.height); // Remember the height of 'tt-sidebar'
		// Remember the first visible row of the <tree id="tt">:
		ss.setWindowValue(aDOMWindow, 'tt-first-visible-row', aDOMWindow.document.querySelector('#tt').treeBoxObject.getFirstVisibleRow().toString());
		Services.prefs.removeObserver('', aDOMWindow.tt.toRemove.prefsObserver); // it can also be removed in 'unloadFromWindow'

		// "themeChangedObserver" must be removed in
		// 1) "onCloseWindow" in case Tab Tree is enabled and one Firefox window is being closed
		// 2) "unloadFromWindow" in case Tab Tree is being disabled
		Services.obs.removeObserver(aDOMWindow.tt.toRemove.themeChangedObserver, "tt-theme-changed");
	},
	
	onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	
	register: function () {
		// Load into any existing windows
		let XULWindows = Services.wm.getXULWindowEnumerator(null);
		while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
			windowListener.loadIntoWindow(aDOMWindow);
		}
		// Listen to new windows
		Services.wm.addListener(windowListener);
	},
	
	unregister: function () {
		// Unload from any existing windows
		let XULWindows = Services.wm.getXULWindowEnumerator(null);
		while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
			windowListener.unloadFromWindow(aDOMWindow, aXULWindow);
		}
		//Stop listening so future added windows don't get this attached
		Services.wm.removeListener(windowListener);
	},
	
	unloadFromWindow: function (aDOMWindow, aXULWindow) {
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		let splitter = aDOMWindow.document.querySelector('#tt-splitter');
		if (splitter) {
			let sidebar = aDOMWindow.document.querySelector('#tt-sidebar');
			ss.deleteWindowValue(aDOMWindow, 'tt-width', sidebar.width); // Restore the width of 'tt-sidebar' to 200px
			ss.deleteWindowValue(aDOMWindow, 'tt-height', sidebar.height); // Restore the height of 'tt-sidebar' to 400px
			splitter.parentNode.removeChild(splitter);
			sidebar.parentNode.removeChild(sidebar);
			let toggler = aDOMWindow.document.querySelector("#tt-toggler");
			toggler.parentNode.removeChild(toggler);
			let hoverArea = aDOMWindow.document.querySelector("#tt-hover-area");
			hoverArea.parentNode.removeChild(hoverArea);
			let titlebarButtonsClone = aDOMWindow.document.querySelector('#titlebar-buttonbox-container.tt-clone');
			if (titlebarButtonsClone && titlebarButtonsClone.parentNode !== null) { // if it exists
				titlebarButtonsClone.parentNode.removeChild(titlebarButtonsClone);
			}
			let slimSpacer = aDOMWindow.document.querySelector('#tt-slimChrome-spacer');
			if(slimSpacer && slimSpacer.parentNode !== null) {
				slimSpacer.parentNode.removeChild(slimSpacer);
			}
			let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
			if (titlebarButtonboxContainer) {
				titlebarButtonboxContainer.style.marginRight = ''; // Beyond Australis compatibility
			}
			let windowControlsClone = aDOMWindow.document.querySelector('#tt-window-controls-clone');
			if (windowControlsClone && windowControlsClone.parentNode !== null) { // if it exists
				windowControlsClone.parentNode.removeChild(windowControlsClone);
			}
			let menuItemCloseTree = aDOMWindow.document.querySelector('#tt-context-close-tree');
			menuItemCloseTree.parentNode.removeChild(menuItemCloseTree);
			let menuItemCloseChildren = aDOMWindow.document.querySelector('#tt-context-close-children');
			menuItemCloseChildren.parentNode.removeChild(menuItemCloseChildren);
			let menuItemReloadTree = aDOMWindow.document.querySelector('#tt-context-reload-tree');
			menuItemReloadTree.parentNode.removeChild(menuItemReloadTree);
			let menuItemOpenNewTabSibling = aDOMWindow.document.querySelector('#tt-content-open-sibling');
			menuItemOpenNewTabSibling.parentNode.removeChild(menuItemOpenNewTabSibling);
			let menuItemOpenNewTabChild = aDOMWindow.document.querySelector('#tt-content-open-child');
			menuItemOpenNewTabChild.parentNode.removeChild(menuItemOpenNewTabChild);
		}
		
		Object.keys(aDOMWindow.tt.toRestore.g).forEach( (x)=>{aDOMWindow.gBrowser[x] = aDOMWindow.tt.toRestore.g[x];} );
		// only 1 at the moment - 'updateContextMenu':
		Object.keys(aDOMWindow.tt.toRestore.TabContextMenu).forEach( (x)=>{aDOMWindow.TabContextMenu[x] = aDOMWindow.tt.toRestore.TabContextMenu[x];} );
		if (aDOMWindow.updateTitlebarDisplay) {
			aDOMWindow.updateTitlebarDisplay = aDOMWindow.tt.toRestore.updateTitlebarDisplay;
		}
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabMove", aDOMWindow.tt.toRemove.eventListeners.onTabMove, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabSelect", aDOMWindow.tt.toRemove.eventListeners.onTabSelect, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabAttrModified", aDOMWindow.tt.toRemove.eventListeners.onTabAttrModified, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("SSWindowStateReady", aDOMWindow.tt.toRemove.eventListeners.onSSWindowStateReady, false);
		aDOMWindow.gBrowser.removeTabsProgressListener(aDOMWindow.tt.toRemove.tabsProgressListener);
		aDOMWindow.removeEventListener("sizemodechange", aDOMWindow.tt.toRemove.eventListeners.onSizemodechange, false);
		aDOMWindow.removeEventListener("keydown", aDOMWindow.tt.toRemove.eventListeners.onWindowKeyPress, false);
		// it's probably already removed but "Calling removeEventListener() with arguments that do not identify any currently registered EventListener ... has no effect.":
		aDOMWindow.document.querySelector('#appcontent').removeEventListener('mouseup', aDOMWindow.tt.toRemove.eventListeners.onAppcontentMouseUp, false);
		aDOMWindow.document.querySelector('#tabContextMenu').removeEventListener("popupshowing", aDOMWindow.tt.toRemove.eventListeners.onPopupshowing, false);
		if (aDOMWindow.tt.toRestore.tabsintitlebar) { // restoring 'tabsintitlebar' attr
			aDOMWindow.document.documentElement.setAttribute("tabsintitlebar", "true"); // hide native titlebar
		} else {
			aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show native titlebar
		}
		aDOMWindow.TabsInTitlebar.updateAppearance(true); // It is needed to recalculate negative 'margin-bottom' for 'titlebar' and 'margin-bottom' for 'titlebarContainer'
		Services.prefs.removeObserver('', aDOMWindow.tt.toRemove.prefsObserver); // it could be already removed in 'onCloseWindow'

		if (Services.appinfo.OS == 'WINNT') { // all Windows despite name 'WINNT' 
			aDOMWindow.tt.toRemove._menuObserver.disconnect();
			aDOMWindow.tt.toRemove._toolboxObserver.disconnect();
		} else if (Services.appinfo.OS == "Darwin") { // disconnect OS X specific MutationObserver
			aDOMWindow.tt.toRemove.osxMutationObserver.disconnect();
		}
		aDOMWindow.tt.toRemove.sidebarWidthObserver.disconnect();
		aDOMWindow.tt.toRemove.numberOfTabsObserver.disconnect();

		// "themeChangedObserver" must be removed in
		// 1) "onCloseWindow" in case Tab Tree is enabled and one Firefox window is being closed
		// 2) "unloadFromWindow" in case Tab Tree is being disabled
		Services.obs.removeObserver(aDOMWindow.tt.toRemove.themeChangedObserver, "tt-theme-changed");

		delete aDOMWindow.tt;
	},
	
	loadIntoWindow: function(aDOMWindow) {
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		if (aDOMWindow.tt) { // To fix bug #15 (Duplicate tree in private browsing mode)
			return;
		}
		let g = aDOMWindow.gBrowser;
		let appcontent = aDOMWindow.document.querySelector('#appcontent');
		let sidebar_box = aDOMWindow.document.querySelector('#sidebar-box');
		let sidebar_header = aDOMWindow.document.querySelector('#sidebar-header');
		aDOMWindow.tt = {
			toRemove: {
				eventListeners: {},
				prefsObserver: null,
				tabsProgressListener: null,
				_menuObserver: null,
				_toolboxObserver: null,
				sidebarWidthObserver: null,
				themeChangedObserver: null,
				osxMutationObserver: null,
			},
			toRestore: {g: {}, TabContextMenu: {}, tabsintitlebar: true},
			dropEvent: {},
		};

		if (!ss.getGlobalValue('tt-saved-widgets')) {
			// "getWidgetIdsInArea" is called here (and not in startup()) because of
			// "NB: will throw if called too early (before placements have been fetched) or if the area is not currently known to CustomizableUI."
			let save = CustomizableUI.getWidgetIdsInArea('TabsToolbar');
			save.forEach(function (x) {
				switch (x) {
					case 'tabbrowser-tabs':
					case 'new-tab-button':
					case 'alltabs-button':
						// "If the widget cannot be removed from its area, or is not in any area, this will no-op."
						CustomizableUI.removeWidgetFromArea(x);
						break;
					default:
						// "If the widget cannot be removed from its original location, this will no-op."
						CustomizableUI.addWidgetToArea(x, 'nav-bar');
				}
			});
			ss.setGlobalValue('tt-saved-widgets', JSON.stringify(save));
		}
		
		// remember 'tabsintitlebar' attr before beginning to interact with it // default is 'true':
		aDOMWindow.tt.toRestore.tabsintitlebar = aDOMWindow.document.documentElement.getAttribute('tabsintitlebar')=='true';

		//////////////////// TITLE BAR STANDARD BUTTONS (Minimize, Restore/Maximize, Close) ////////////////////////////
		// We can't use 'window.load' event here, because it always shows windowState==='STATE_NORMAL' even when the actual state is 'STATE_MAXIMIZED'

		// Now we have elements with the same id:
		let titlebarButtons = aDOMWindow.document.querySelector('#titlebar-buttonbox-container'); // it's present only on Windows and Mac
		let titlebarButtonsClone;
		if (titlebarButtons && Services.appinfo.OS == 'WINNT') { // it's present only on Windows and Mac
			titlebarButtonsClone = aDOMWindow.document.querySelector('#titlebar-buttonbox-container').cloneNode(true);
			titlebarButtonsClone.classList.add('tt-clone'); // add a class to distinguish the elements with the same id
		}
		let menu = aDOMWindow.document.querySelector('#toolbar-menubar');
		let navToolbox = aDOMWindow.document.querySelector('#navigator-toolbox');
		let navBar = aDOMWindow.document.querySelector('#nav-bar');
		let windowControlsClone = aDOMWindow.document.querySelector('#window-controls').cloneNode(true);
		windowControlsClone.id = 'tt-window-controls-clone'; // change id to distinguish the new element
		windowControlsClone.hidden = false;
		
		let slimSpacer = aDOMWindow.document.createElement('spacer');
		slimSpacer.id = 'tt-slimChrome-spacer';
		slimSpacer.setAttribute('flex', '1');
		
		if (aDOMWindow.updateTitlebarDisplay) {
			// #136 [Bug] UI breaks with Firefox 47
			// More info at https://dxr.mozilla.org/mozilla-central/source/browser/base/content/browser-tabsintitlebar.js
			aDOMWindow.tt.toRestore.updateTitlebarDisplay = aDOMWindow.updateTitlebarDisplay;
			aDOMWindow.updateTitlebarDisplay = new Proxy(aDOMWindow.updateTitlebarDisplay, {
				apply: function(target, thisArg, argumentsList) {
					target.apply(thisArg, argumentsList);
					if (aDOMWindow.windowState === aDOMWindow.STATE_NORMAL) {
						// #154 [Bug] Broken compatibility with Hide Caption Titlebar Plus since version 1.4.7
						AddonManager.getAddonByID("hidecaptionplus-dp@dummy.addons.mozilla.org", function (addon) {
							if (addon && addon.isActive) {
								// "Hide Caption Titlebar Plus" is installed and enabled
							} else {
								aDOMWindow.document.documentElement.removeAttribute("chromemargin");
							}
						});
					}
				}
			});
		}
		
		// console.log(`Window: '${aDOMWindow.document.title} (${g.tabs.length})' (windowState=${aDOMWindow.windowState}). Injecting Tab Tree ...`);
		
		if (Services.appinfo.OS == 'WINNT') {
			switch (aDOMWindow.windowState) {
				case aDOMWindow.STATE_MAXIMIZED:
					if (Services.prefs.getBoolPref('browser.tabs.drawInTitlebar')) {
						if (menu.getAttribute('autohide') == 'true' && menu.hasAttribute('inactive')) {
							// BEGIN Beyond Australis compatibility:
							// window controls wouldn't be visible because the buttonbox container wouldn't be in the right place
							if(navToolbox.getAttribute('slimChromeNavBar') == 'true') {
								let slimmer = aDOMWindow.document.querySelector('#theFoxOnlyBetter-slimChrome-slimmer');
								slimmer.appendChild(slimSpacer);
								slimmer.appendChild(titlebarButtonsClone);
							} else {
								navBar.appendChild(titlebarButtonsClone);
								if(slimSpacer.parentNode !== null) {
									slimSpacer.parentNode.removeChild(slimSpacer);
								}
								
							}
							// END Beyond Australis compatibility
							
							// It can't be plain ".collapsed = true" because it would affect ".updateTitlebarDisplay()"
							// and consequently "aDOMWindow.TabsInTitlebar.updateAppearance(true);" margin calculations:
							titlebarButtons.style.marginRight = '-9999px'; // Beyond Australis compatibility
							aDOMWindow.document.documentElement.setAttribute("tabsintitlebar", "true"); // hide native titlebar
							aDOMWindow.updateTitlebarDisplay();
						}
					}
					break;
				case aDOMWindow.STATE_NORMAL:
					aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show native titlebar
					aDOMWindow.updateTitlebarDisplay();
					break;
				case aDOMWindow.STATE_FULLSCREEN:
					navBar.appendChild(windowControlsClone);
					break;
			}

			aDOMWindow.addEventListener('sizemodechange', (aDOMWindow.tt.toRemove.eventListeners.onSizemodechange = function(event) {
				// console.log(`Window: '${aDOMWindow.document.title} (${g.tabs.length})' (windowState=${aDOMWindow.windowState}). Event: 'sizemodechange'`);
				switch (aDOMWindow.windowState) {
					case aDOMWindow.STATE_MAXIMIZED:
						if (windowControlsClone.parentNode !== null) { // if windowControlsClone exists
							navBar.removeChild(windowControlsClone);
						}
						if (Services.prefs.getBoolPref('browser.tabs.drawInTitlebar')) {
							if (menu.getAttribute('autohide') == 'true' && menu.hasAttribute('inactive')) {
								// BEGIN Beyond Australis compatibility:
								// window controls wouldn't be visible because the buttonbox container wouldn't be in the right place
								if(navToolbox.getAttribute('slimChromeNavBar') == 'true') {
									let slimmer = aDOMWindow.document.querySelector('#theFoxOnlyBetter-slimChrome-slimmer');
									slimmer.appendChild(slimSpacer);
									slimmer.appendChild(titlebarButtonsClone);
								} else {
									navBar.appendChild(titlebarButtonsClone);
									if(slimSpacer.parentNode !== null) {
										slimSpacer.parentNode.removeChild(slimSpacer);
									}
									
								}
								// END Beyond Australis compatibility
								
								titlebarButtons.style.marginRight = '-9999px'; // Beyond Australis compatibility
								aDOMWindow.setTimeout(() => {
									aDOMWindow.document.documentElement.setAttribute("tabsintitlebar", "true"); // hide native titlebar
									aDOMWindow.updateTitlebarDisplay();
								}, 0);
							}
						}
						break;
					case aDOMWindow.STATE_NORMAL:
						if (windowControlsClone.parentNode !== null) { // if windowControlsClone exists
							navBar.removeChild(windowControlsClone);
						}
						aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show native toolbar
						if (titlebarButtonsClone.parentNode !== null) { // if it exists
							titlebarButtonsClone.parentNode.removeChild(titlebarButtonsClone);
							titlebarButtons.style.marginRight = ''; // Beyond Australis compatibility
							if(slimSpacer.parentNode !== null) {
								slimSpacer.parentNode.removeChild(slimSpacer);
							}
						}
						aDOMWindow.updateTitlebarDisplay();
						break;
					case aDOMWindow.STATE_FULLSCREEN:
						if (titlebarButtonsClone.parentNode !== null) { // if it exists
							titlebarButtonsClone.parentNode.removeChild(titlebarButtonsClone);
							titlebarButtons.style.marginRight = ''; // Beyond Australis compatibility
							if(slimSpacer.parentNode !== null) {
								slimSpacer.parentNode.removeChild(slimSpacer);
							}
						}
						navBar.appendChild(windowControlsClone);
						break;
				}
			}), false); // removed in unloadFromWindow()

			(aDOMWindow.tt.toRemove._menuObserver = new aDOMWindow.MutationObserver(function(aMutations) {
				for (let mutation of aMutations) {
					if (mutation.attributeName == 'inactive' || mutation.attributeName == 'autohide') {
						if (
							Services.prefs.getBoolPref('browser.tabs.drawInTitlebar') &&
							aDOMWindow.windowState==aDOMWindow.STATE_MAXIMIZED &&
							mutation.target.getAttribute('autohide')=='true' &&
							mutation.target.hasAttribute('inactive')
						) {
							// BEGIN Beyond Australis compatibility:
							// window controls wouldn't be visible because the buttonbox container wouldn't be in the right place
							if(navToolbox.getAttribute('slimChromeNavBar') == 'true') {
								let slimmer = aDOMWindow.document.querySelector('#theFoxOnlyBetter-slimChrome-slimmer');
								slimmer.appendChild(slimSpacer);
								slimmer.appendChild(titlebarButtonsClone);
							} else {
								navBar.appendChild(titlebarButtonsClone);
								if(slimSpacer.parentNode !== null) {
									slimSpacer.parentNode.removeChild(slimSpacer);
								}
								
							}
							// END Beyond Australis compatibility
							
							titlebarButtons.style.marginRight = '-9999px'; // Beyond Australis compatibility
						} else {
							if (titlebarButtonsClone.parentNode !== null) { // if it exists
								titlebarButtonsClone.parentNode.removeChild(titlebarButtonsClone);
								if(slimSpacer.parentNode !== null) {
									slimSpacer.parentNode.removeChild(slimSpacer);
								}
							}
							titlebarButtons.style.marginRight = ''; // Beyond Australis compatibility
						}
						return;
					}
				}
			})).observe(menu, {attributes: true}); // removed in unloadFromWindow()

			(aDOMWindow.tt.toRemove._toolboxObserver = new aDOMWindow.MutationObserver(function(aMutations) {
				for (let mutation of aMutations) {
					if (mutation.attributeName == 'slimChromeNavBar') {
						if (
							Services.prefs.getBoolPref('browser.tabs.drawInTitlebar') &&
							aDOMWindow.windowState==aDOMWindow.STATE_MAXIMIZED &&
							menu.getAttribute('autohide')=='true' &&
							menu.hasAttribute('inactive')
						) {
							// BEGIN Beyond Australis compatibility:
							// window controls wouldn't be visible because the buttonbox container wouldn't be in the right place
							if(navToolbox.getAttribute('slimChromeNavBar') == 'true') {
								let slimmer = aDOMWindow.document.querySelector('#theFoxOnlyBetter-slimChrome-slimmer');
								slimmer.appendChild(slimSpacer);
								slimmer.appendChild(titlebarButtonsClone);
							} else {
								navBar.appendChild(titlebarButtonsClone);
								if(slimSpacer.parentNode !== null) {
									slimSpacer.parentNode.removeChild(slimSpacer);
								}
								
							}
							// END Beyond Australis compatibility
							
							titlebarButtons.style.marginRight = '-9999px'; // Beyond Australis compatibility
						} else {
							if (titlebarButtonsClone.parentNode !== null) { // if it exists
								titlebarButtonsClone.parentNode.removeChild(titlebarButtonsClone);
								if(slimSpacer.parentNode !== null) {
									slimSpacer.parentNode.removeChild(slimSpacer);
								}
							}
							titlebarButtons.style.marginRight = ''; // Beyond Australis compatibility
						}
						return;
					}
				}
			})).observe(navToolbox, {attributes: true}); // removed in unloadFromWindow()
		} else if (Services.appinfo.OS == 'Darwin') { // Mac
			// here we just always force a native titlebar
			// it's probably possible to move minimize/maximize/close buttons to #nav-bar
			// but it would probably look ugly therefore we just mimic Safari
			aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show a native titlebar like in Safari

			// It seems that Firefox restores "chromemargin" and "tabsintitlebar" attributes by itself
			// It sometimes happens when resizing a Firefox window
			// So we can't rely upon the "sizemodechange" event
			// And we use MutationObvserver instead:
			(aDOMWindow.tt.toRemove.osxMutationObserver = new aDOMWindow.MutationObserver((mutations) => {
				for (let mutation of mutations) {
					if (mutation.attributeName === "tabsintitlebar" || mutation.attributeName === "chromemargin") {
						aDOMWindow.document.documentElement.removeAttribute("chromemargin");
						aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar");
						return;
					}
				}
			})).observe(aDOMWindow.document.documentElement, {attributes: true}); // removed in unloadFromWindow()

			aDOMWindow.updateTitlebarDisplay();
		} else { // Linux
		    // Set tab position to buttom to fix compatibility with certain extensions:
			navBar.setAttribute('default-tabs-position', 'bottom');
			// here we are concerned only with STATE_FULLSCREEN:
			switch (aDOMWindow.windowState) {
				case aDOMWindow.STATE_FULLSCREEN:
					navBar.appendChild(windowControlsClone);
					break;
			}

			aDOMWindow.addEventListener('sizemodechange', (aDOMWindow.tt.toRemove.eventListeners.onSizemodechange = function(event) {
				switch (aDOMWindow.windowState) {
					case aDOMWindow.STATE_MAXIMIZED:
					case aDOMWindow.STATE_NORMAL:
						if (windowControlsClone.parentNode !== null) { // if windowControlsClone exists
							navBar.removeChild(windowControlsClone);
						}
						break;
					case aDOMWindow.STATE_FULLSCREEN:
						navBar.appendChild(windowControlsClone);
						break;
				}
			}), false); // removed in unloadFromWindow()
		}
		//////////////////// END TITLE BAR STANDARD BUTTONS (Minimize, Restore/Maximize, Close) ////////////////////////

		let propsToSet;
		
		//  for "Left" position:
		//  <spacer id="tt-toggler" />
		//  <vbox id="tt-sidebar" width="200">
		//    <toolbox></toolbox>
		//    <tree id="tt" flex="1" seltype="single" context="tabContextMenu" treelines="true" hidecolumnpicker="true"></tree>
		//  </vbox>
		//  <splitter id="tt-splitter" />
		//  <vbox id="tt-hover-area></vbox>"

		//  for "Right" position:
		//  <vbox id="tt-hover-area></vbox>"
		//  <splitter id="tt-splitter" />
		//  <vbox id="tt-sidebar" width="200">
		//    <toolbox></toolbox>
		//    <tree id="tt" flex="1" seltype="single" context="tabContextMenu" treelines="true" hidecolumnpicker="true"></tree>
		//  </vbox>
		//  <spacer id="tt-toggler" />

		//  for "sidebar top" position:
		//  <vbox id="sidebar-box">
		//    <vbox id="tt-sidebar"></vbox>
		//    <splitter id="tt-splitter" />
		//    <sidebarheader id="sidebar-header"></sidebarheader>
		//    ...
		//  </vbox>

		//  for "sidebar bottom" position:
		//  <vbox id="sidebar-box">
		//     ...
		//     <browser id="sidebar"></browser>
		//     <splitter id="tt-splitter" />
		//     <vbox id="tt-sidebar"></vbox>
		//  </vbox>
		
		//////////////////// #tt-toggler /////////////////////////////////////////////////////////////////////////////////
		let toggler = aDOMWindow.document.createElement("spacer");
		toggler.id = "tt-toggler";
		//////////////////////////////////////////////////////////////////////////////////////////////////////////////////
		
		//////////////////// VBOX ///////////////////////////////////////////////////////////////////////
		let sidebar = aDOMWindow.document.createElement('vbox');
		propsToSet = {
			id: 'tt-sidebar',
			width: ss.getWindowValue(aDOMWindow, 'tt-width') || ss.getGlobalValue('tt-new-sidebar-width') || '200',
			height: ss.getWindowValue(aDOMWindow, 'tt-height') || ss.getGlobalValue('tt-new-sidebar-height') || '400'
			//persist: 'width' // It seems 'persist' attr doesn't work in bootstrap addons, I'll use SS instead
		};
		Object.keys(propsToSet).forEach( (p)=>{sidebar.setAttribute(p, propsToSet[p])} );
		// added later
		//////////////////// END VBOX ///////////////////////////////////////////////////////////////////////
		
		//////////////////// SPLITTER ///////////////////////////////////////////////////////////////////////
		let splitter = aDOMWindow.document.createElement('splitter');
		propsToSet = {
			id: 'tt-splitter'
			//class: 'sidebar-splitter' // "I'm just copying what mozilla does for their social sidebar splitter"
			// "I left it out, but you can leave it in to see how you can style the splitter"
		};
		Object.keys(propsToSet).forEach( (p)=>{splitter.setAttribute(p, propsToSet[p]);} );
		// added later
		//////////////////// END SPLITTER ///////////////////////////////////////////////////////////////////////
		
		//////////////////// #tt-hover-area /////////////////////////////////////////////////////////////////////////////////
		let hoverArea = aDOMWindow.document.createElement("vbox");
		hoverArea.id = "tt-hover-area";
		//////////////////////////////////////////////////////////////////////////////////////////////////////////////////

		let setTTPos = function (aPos) {
			splitter.removeAttribute("resizeafter");
			switch (aPos) {
				case TT_POS_SB_TOP:
					sidebar_box.insertBefore(toggler, sidebar_header.nextElementSibling);
					sidebar_box.insertBefore(sidebar, toggler.nextElementSibling);
					sidebar_box.insertBefore(splitter, sidebar.nextElementSibling);
					sidebar_box.insertBefore(hoverArea, splitter.nextElementSibling);
					splitter.setAttribute("resizebefore", "closest");
					splitter.setAttribute("resizeafter", "farthest");
					splitter.setAttribute("orient", "vertical");
					break;
				case TT_POS_SB_BOT:
					sidebar_box.appendChild(hoverArea);
					sidebar_box.appendChild(splitter);
					sidebar_box.appendChild(sidebar);
					sidebar_box.appendChild(toggler);
					splitter.setAttribute("resizebefore", "flex");
					splitter.setAttribute("resizeafter", "closest");
					splitter.setAttribute("orient", "vertical");
					break;
				case TT_POS_RIGHT:
					browser.appendChild(hoverArea);
					browser.appendChild(splitter);
					browser.appendChild(sidebar);
					browser.appendChild(toggler);
					splitter.setAttribute("resizebefore", "flex");
					splitter.setAttribute("resizeafter", "closest");
					splitter.setAttribute("orient", "horizontal");
					break;
				case TT_POS_LEFT:
				default:
					browser.insertBefore(toggler, appcontent);
					browser.insertBefore(sidebar, appcontent);
					browser.insertBefore(splitter, appcontent);
					browser.insertBefore(hoverArea, appcontent);
					splitter.setAttribute("resizebefore", "closest");
					splitter.setAttribute("resizeafter", "flex");
					splitter.setAttribute("orient", "horizontal");
					break;
			}
		};
		setTTPos(Services.prefs.getIntPref('extensions.tabtree.position'));
		
		//////////////////// DROP INDICATOR //////////////////////////////////////////////////////////////////////////////
		/*
		<hbox id="tt-drop-indicator-container">
			<image id="tt-drop-indicator" />
		</hbox>
		*/
		let dropIndicator = aDOMWindow.document.createElement("image");
		dropIndicator.id = "tt-drop-indicator";
		let dropIndicatorContainer = aDOMWindow.document.createElement("hbox");
		dropIndicatorContainer.id = "tt-drop-indicator-container";
		dropIndicatorContainer.appendChild(dropIndicator);
		sidebar.appendChild(dropIndicatorContainer);
		dropIndicator.collapsed = true;
		//////////////////// END DROP INDICATOR //////////////////////////////////////////////////////////////////////////

		//////////////////// TOOLBOX /////////////////////////////////////////////////////////////////
		/*
		<toolbox id="tt-toolbox">
			<toolbar id="tt-toolbar">
				<ttpinnedtab /> <!-- see bindings.xml -->
				<ttpinnedtab />
				<ttpinnedtab />
				<ttpinnedtab />
				...
			</toolbar>
		</toolbox>
		*/
		// #tt-toolbox can be decorated to look different in different themes
		// borders shouldn't be added to #tt-toolbar because they slightly break drag'n'drop behaviour
		let toolbox = aDOMWindow.document.createElement('toolbox');
		toolbox.id = 'tt-toolbox';
		let toolbar = aDOMWindow.document.createElement('toolbar');
		toolbar.id = 'tt-toolbar';
		toolbar.setAttribute('fullscreentoolbar', 'true');
		toolbox.appendChild(toolbar);
		sidebar.appendChild(toolbox);
		//////////////////// END TOOLBOX /////////////////////////////////////////////////////////////////

		//////////////////// TREE ///////////////////////////////////////////////////////////////////////
		/*
			<tree id="tt" flex="1" seltype="single" context="tabContextMenu" treelines="true" hidecolumnpicker="true"> // approximately
					<treecols>
						 <treecol id="namecol" label="Name" primary="true" flex="1"/>
					</treecols>
					<treechildren id="tt-treechildren"/>
			</tree>
		*/
		let tree = aDOMWindow.document.createElement('tree'); // <tree>
		tree.classList.add("tt-tree");
		propsToSet = {
			id: 'tt',
			flex: '1',
			seltype: 'single',
			context: 'tabContextMenu',
			treelines: Services.prefs.getBoolPref('extensions.tabtree.treelines').toString(),
			hidecolumnpicker: 'true'
		};
		Object.keys(propsToSet).forEach( (p)=>{tree.setAttribute(p, propsToSet[p]);} );

		let treecols = aDOMWindow.document.createElement('treecols'); // <treecols>
		let treecol = {
			tabtitle: aDOMWindow.document.createElement('treecol'), // <treecol>
			overlay:  aDOMWindow.document.createElement('treecol'), // <treecol>
			closebtn: aDOMWindow.document.createElement('treecol'), // <treecol>
			scrollbar: aDOMWindow.document.createElement('treecol'), // <treecol>
		};
		propsToSet = {
			id: 'tt-title',
			flex: '1',
			primary: 'true',
			hideheader: 'true'
		};
		Object.keys(propsToSet).forEach( (p)=>{treecol.tabtitle.setAttribute(p, propsToSet[p]);} );
		treecol.overlay.setAttribute('hideheader', 'true');
		treecol.overlay.id = 'tt-overlay';
		// Hiding TT_COL_OVERLAY column when there's no at least 1 audio indicator and vice versa
		// Duplicate this code in onTabAttrModified, pinTab and unpinTab
		treecol.overlay.collapsed = !Array.some(g.tabs, (x) => !x.pinned && (x.hasAttribute('muted') || x.hasAttribute('soundplaying')));
		treecol.closebtn.setAttribute('hideheader', 'true');
		treecol.closebtn.id = 'tt-close';
		treecol.closebtn.collapsed = !Services.prefs.getBoolPref('extensions.tabtree.close-tab-buttons');
		treecol.scrollbar.setAttribute('hideheader', 'true');
		treecol.scrollbar.id = 'tt-scrollbar';

		let treetooltip = aDOMWindow.document.createElement('tooltip');
		treetooltip.setAttribute('id', 'tt-tooltip');
		treetooltip.setAttribute('label', '');
		tree.appendChild(treetooltip);

		let treechildren = aDOMWindow.document.createElement('treechildren'); // <treechildren id="tt-treechildren">
		treechildren.classList.add("tt-treechildren");
		treechildren.setAttribute('id', 'tt-treechildren');
		treechildren.setAttribute('tooltip', 'tt-tooltip');

		treecols.appendChild(treecol.tabtitle);
		treecols.appendChild(treecol.overlay);
		treecols.appendChild(treecol.closebtn);
		treecols.appendChild(treecol.scrollbar);
		tree.appendChild(treecols);
		tree.appendChild(treechildren);
		sidebar.appendChild(tree);

		// #63 [Ubuntu] Glitch with page up or down
		// We can't override <handler event="keydown" keycode="VK_PAGE_UP" modifiers="accel any">
		// in chrome://global/content/bindings/tree.xml#tree
		// because if we attempt to override it two handlers will be attached instead:
		tree._moveByPage = new Proxy(tree._moveByPage, { // #63 [Ubuntu] Glitch with page up or down
			apply: function(target, thisArg, argumentsList) {
				g.mCurrentBrowser.focus();
			}
		}); // there's no need to restore it

		tree._moveByOffset = new Proxy(tree._moveByOffset, { // #63 [Ubuntu] Glitch with page up or down
			apply: function(target, thisArg, argumentsList) {
				g.mCurrentBrowser.focus();
			}
		}); // there's no need to restore it
		//////////////////// END TREE /////////////////////////////////////////////////////////////////

		//////////////////// DRAG FEEDBACK TREE ////////////////////////////////////////////////////////////////////////
		let dragFeedbackTree = aDOMWindow.document.createElement('tree');
		dragFeedbackTree.classList.add("tt-tree");
		/*
		 * <tree id="tt-feedback" seltype="single" treelines="true/false" hidecolumnpicker="true">
		 * 	<treecols>
		 * 		<treecol primary="true" flex="1" hideheader="true" />
		 * 	</treecols>
		 * 	<treechildren/>
		 * </tree>
		 */
		dragFeedbackTree.setAttribute('id', 'tt-feedback');
		//dragFeedbackTree.setAttribute('flex', '1');
		dragFeedbackTree.setAttribute('seltype', 'single');
		dragFeedbackTree.setAttribute('treelines', Services.prefs.getBoolPref('extensions.tabtree.treelines').toString());
		dragFeedbackTree.setAttribute('hidecolumnpicker', 'true');
		let treecolsDragFeedback = aDOMWindow.document.createElement('treecols');
		let treecolDragFeedback = {
			tabtitle: aDOMWindow.document.createElement('treecol'),
			overlay: aDOMWindow.document.createElement('treecol'),
			closebtn: aDOMWindow.document.createElement('treecol'),
		};
		treecolDragFeedback.tabtitle.setAttribute('id', 'tt-df-title');
		treecolDragFeedback.tabtitle.setAttribute('flex', '1');
		treecolDragFeedback.tabtitle.setAttribute('primary', 'true');
		treecolDragFeedback.tabtitle.setAttribute('hideheader', 'true');

		treecolDragFeedback.overlay.setAttribute('id', 'tt-df-overlay');
		treecolDragFeedback.overlay.setAttribute('hideheader', 'true');

		treecolDragFeedback.closebtn.setAttribute('id', 'tt-df-close');
		treecolDragFeedback.closebtn.setAttribute('hideheader', 'true');
		treecolDragFeedback.closebtn.collapsed = !Services.prefs.getBoolPref('extensions.tabtree.close-tab-buttons');
		let treechildrenDragFeedback = aDOMWindow.document.createElement('treechildren');
		treechildrenDragFeedback.classList.add("tt-treechildren");
		treechildrenDragFeedback.setAttribute('id', 'tt-treechildren-feedback');
		treecolsDragFeedback.appendChild(treecolDragFeedback.tabtitle);
		treecolsDragFeedback.appendChild(treecolDragFeedback.overlay);
		treecolsDragFeedback.appendChild(treecolDragFeedback.closebtn);
		dragFeedbackTree.appendChild(treecolsDragFeedback);
		dragFeedbackTree.appendChild(treechildrenDragFeedback);

		// I don't know why but it doesn't work without a container (in that case <tree> always has 0 rows):
		let dragFeedbackTreeContainer = aDOMWindow.document.createElement('vbox');
		// It's all to work around Firefox bug #1199669 (I can't use <panel> element here):
		dragFeedbackTreeContainer.style.position = 'fixed'; // I don't know why but 'absolute' doesn't work
		dragFeedbackTreeContainer.style.left = '-9999px';

        dragFeedbackTreeContainer.appendChild(dragFeedbackTree);
        sidebar.appendChild(dragFeedbackTreeContainer);
		//////////////////// END DRAG FEEDBACK TREE ////////////////////////////////////////////////////////////////////

		////////////////////////////////////////////// NEW TAB BUTTON //////////////////////////////////////////////////
		let newTabContainer = aDOMWindow.document.createElement('vbox'); /* there is a problem with 'background-color' without a container*/
		newTabContainer.id = 'tt-new-tab-button-container';
		let newTab = aDOMWindow.document.createElement('toolbarbutton');
		newTab.classList.add('tt-new-tab-button');
		newTab.collapsed = !Services.prefs.getBoolPref('extensions.tabtree.new-tab-button');
		// <tooltip id="dynamic-shortcut-tooltip" onpopupshowing="UpdateDynamicShortcutTooltipText(this);"/>
		// UpdateDynamicShortcutTooltipText uses 'id' and 'anonid' to provide the tooltip text:
		newTab.setAttribute('anonid', 'tabs-newtab-button');
		newTab.setAttribute('tooltip', 'dynamic-shortcut-tooltip');
		newTabContainer.appendChild(newTab);
		sidebar.appendChild(newTabContainer);
		////////////////////////////////////////////////////////////////////////////////////////////////////////////////

		//////////////////// QUICK SEARCH BOX ////////////////////////////////////////////////////////////////////////
		let quickSearchBox = aDOMWindow.document.createElement('textbox');
		quickSearchBox.id = 'tt-quicksearchbox';
		quickSearchBox.setAttribute('placeholder', stringBundle.GetStringFromName('tabs_quick_search'));
		switch (Services.prefs.getIntPref('extensions.tabtree.search-position')) {
		case 1:
			sidebar.insertBefore(quickSearchBox, newTabContainer); // before "New tab" button
			break;
		case 2:
			sidebar.appendChild(quickSearchBox); // after "New tab" button
			break;
		default: // case 0 // at the top
			sidebar.insertBefore(quickSearchBox, sidebar.firstChild);
		}
		quickSearchBox.collapsed = Services.prefs.getBoolPref('extensions.tabtree.search-autohide');
		//////////////////// END QUICK SEARCH BOX /////////////////////////////////////////////////////////////////

		/////////////////////////// PSEUDO-ANIMATED PNG ////////////////////////////////////////////////////////////////
		// my way to force Firefox to cache images. Otherwise they would be loaded upon the first request (a tab load/refresh) and it wouldn't look smooth:
		// I can't use a real animated PNG with <tree> element because it causes abnormally high CPU load
		let pngsConnecting = aDOMWindow.document.createElement('hbox');
		let pngsLoading = aDOMWindow.document.createElement('hbox');
		for (let i=1; i<=18; ++i) { // 18 frames for each animated png
			let pngConnecting = aDOMWindow.document.createElement('image');
			let pngLoading = aDOMWindow.document.createElement('image');
			pngConnecting.setAttribute('collapsed', 'true');
			pngLoading.setAttribute('collapsed', 'true');
			pngConnecting.setAttribute('src', 'chrome://tabtree/skin/connecting-F'+i+'.png');
			pngLoading.setAttribute('src', 'chrome://tabtree/skin/loading-F'+i+'.png');
			pngsConnecting.appendChild(pngConnecting);
			pngsLoading.appendChild(pngLoading);
		}
		sidebar.appendChild(pngsConnecting);
		sidebar.appendChild(pngsLoading);
		/////////////////////// END PSEUDO-ANIMATED PNG ////////////////////////////////////////////////////////////////

		//////////////////// KEY ///////////////////////////////////////////////////////////////////////////////////////
		// 'keydown' provides the keyCode ('keypress' does not)
		aDOMWindow.addEventListener('keydown', (aDOMWindow.tt.toRemove.eventListeners.onWindowKeyPress = function(keyboardEvent) {
			// convert to a key that works on all keyboard layouts
			let helper = keyboardHelper(keyboardEvent);
			if (keyboardEvent.ctrlKey && keyboardEvent.altKey && keyboardEvent.shiftKey && helper.testCode('KeyF', 'f')) {
				quickSearchBox.collapsed = false;
				quickSearchBox.focus();
			} else if (keyboardEvent.ctrlKey && keyboardEvent.altKey && keyboardEvent.shiftKey && helper.testKey('PageDown', 'pagedown')) {
				// #68 Ctrl+Alt+Shift+PageDown - slow moving speed:
				let tab = g.mCurrentTab;
				let nextTab = g.tabs[tt.lastDescendantPos(tab)+1];
				if (nextTab) {
					if (tt.levelInt(tab) === tt.levelInt(nextTab)) {
						if (tt.hasAnyChildren(nextTab._tPos)) {
							tt.moveBranchToPlus(tab, nextTab._tPos, tree.view.DROP_AFTER);
						} else {
							tt.moveBranchToPlus(tab, nextTab._tPos, tree.view.DROP_ON);
						}
					} else if (tt.levelInt(tab) === tt.levelInt(nextTab) + 1) {
						tt.moveBranchToPlus(tab, nextTab._tPos, tree.view.DROP_BEFORE);
					} else if (tt.levelInt(tab) > tt.levelInt(nextTab) + 1) {
						let grandparend = tt.parentTab(tt.parentTab(tab));
						tt.moveBranchToPlus(tab, grandparend._tPos, tree.view.DROP_ON);
					}
				} else if (g.arrowKeysShouldWrap) {
					g.moveTabToStart();
				}
				tree.treeBoxObject.invalidate();
			} else if (keyboardEvent.ctrlKey && keyboardEvent.altKey && keyboardEvent.shiftKey && helper.testKey('PageUp', 'pageup')) {
				// #68 Ctrl+Alt+Shift+PageUp - slow moving speed:
				let tab = g.mCurrentTab;
				let previousTab = tab.previousSibling;
				while (previousTab && previousTab.hidden) {
					previousTab = previousTab.previousSibling;
				}
				if (previousTab) {
					if (tt.levelInt(tab) === tt.levelInt(previousTab)) {
						if (tt.hasAnyChildren(previousTab._tPos)) {
							tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_BEFORE);
						} else {
							tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_ON);
						}
					} else if (tt.levelInt(tab) < tt.levelInt(previousTab)) { // move into a subtree
						let previousTabOnTheSameLevel = previousTab.previousSibling;
						while (previousTabOnTheSameLevel && tt.levelInt(tab) < tt.levelInt(previousTabOnTheSameLevel)) {
							previousTabOnTheSameLevel = previousTabOnTheSameLevel.previousSibling;
						}
						tt.moveBranchToPlus(tab, previousTabOnTheSameLevel._tPos, tree.view.DROP_ON);
					} else if (tt.levelInt(tab) > tt.levelInt(previousTab)) { // move out of a subtree
						tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_BEFORE);
					}
				} else if (g.arrowKeysShouldWrap) {
					g.moveTabToEnd();
				}
				tree.treeBoxObject.invalidate();
			} else if (keyboardEvent.altKey && keyboardEvent.shiftKey && helper.testKey('PageDown', 'pagedown')) {
				// #68 Shift+Alt+PageDown - fast moving speed:
				let tab = g.mCurrentTab;
				let nextTab = g.tabs[tt.lastDescendantPos(tab)+1];
				if (nextTab) {
					if (tt.levelInt(tab) === tt.levelInt(nextTab)) {
						// Not the cleanest solution (but it's needed to move after the last tab without errors):
						let lastDescendantTab = g.tabs[tt.lastDescendantPos(nextTab)];
						let oldLevel = tt.levelInt(lastDescendantTab);
						tt.setLevel(lastDescendantTab, tt.levelInt(nextTab));
						tt.moveBranchToPlus(tab, lastDescendantTab._tPos, tree.view.DROP_AFTER);
						tt.setLevel(lastDescendantTab, oldLevel);
					} else if (tt.levelInt(tab) === tt.levelInt(nextTab) + 1) {
						tt.moveBranchToPlus(tab, nextTab._tPos, tree.view.DROP_BEFORE);
					} else if (tt.levelInt(tab) > tt.levelInt(nextTab) + 1) {
						let grandparent = tt.parentTab(tt.parentTab(tab));
						tt.moveBranchToPlus(tab, grandparent._tPos, tree.view.DROP_ON);
					}
				} else if (g.arrowKeysShouldWrap) {
					g.moveTabToStart();
				}
				tree.treeBoxObject.invalidate();
			} else if (keyboardEvent.altKey && keyboardEvent.shiftKey && helper.testKey('PageUp', 'pageup')) {
				// #68 Shift+Alt+PageUp - fast moving speed:
				let tab = g.mCurrentTab;
				let previousTab = tab.previousSibling;
				while (previousTab && previousTab.hidden) {
					previousTab = previousTab.previousSibling;
				}
				if (previousTab) {
					if (tt.levelInt(tab) === tt.levelInt(previousTab)) {
						tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_BEFORE);
					} else if (tt.levelInt(tab) < tt.levelInt(previousTab)) { // move far away
						let previousTabOnTheSameLevel = previousTab.previousSibling;
						while (previousTabOnTheSameLevel && tt.levelInt(tab) < tt.levelInt(previousTabOnTheSameLevel)) {
							previousTabOnTheSameLevel = previousTabOnTheSameLevel.previousSibling;
						}
						tt.moveBranchToPlus(tab, previousTabOnTheSameLevel._tPos, tree.view.DROP_BEFORE);
					} else if (tt.levelInt(tab) > tt.levelInt(previousTab)) { // move out of a subtree
						tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_BEFORE);
					}
				} else if (g.arrowKeysShouldWrap) {
					g.moveTabToEnd();
				}
				tree.treeBoxObject.invalidate();
			} else if (keyboardEvent.ctrlKey && keyboardEvent.shiftKey && helper.testCode('Comma', ',')) {
				// #68 Decrease tab indentation one level:
				// Ctrl+Alt+Left/Right is already used on OS X — we can't use it
				let lvl = parseInt(ss.getTabValue(g.mCurrentTab, "ttLevel"));
				if (lvl <= 0) {
					return;
				}
				let newLvl = (lvl - 1).toString();
				ss.setTabValue(g.mCurrentTab, "ttLevel", newLvl);
				tree.treeBoxObject.invalidate();
				// - we can't use `tree.treeBoxObject.invalidateRow(g.mCurrentTab._tPos - g._numPinnedTabs);`
				// because in some cases we also have to redraw nesting lines at least on the previous and the next tab
			} else if (keyboardEvent.ctrlKey && keyboardEvent.shiftKey && helper.testCode('Period', '.')) {
				// #68 Increase tab indentation one level:
				// Ctrl+Alt+Left/Right is already used on OS X — we can't use it
				let lvl = parseInt(ss.getTabValue(g.mCurrentTab, "ttLevel"));
				let newLvl = (lvl + 1).toString();
				ss.setTabValue(g.mCurrentTab, "ttLevel", newLvl);
				tree.treeBoxObject.invalidate();
				// - we can't use `tree.treeBoxObject.invalidateRow(g.mCurrentTab._tPos - g._numPinnedTabs);`
				// because in some cases we also have to redraw nesting lines at least on the previous and the next tab
			} else if (helper.testKey(Services.prefs.getCharPref("extensions.tabtree.auto-hide-key"), Services.prefs.getCharPref("extensions.tabtree.auto-hide-key").toLowerCase())) {
				// #40 #80 F8 toggles 4 auto-hide options:
				// 1. in fullscreen
				// 2. in maximized windows
				// 3. in normal windows
				// 4. when only one tab
				if (g.tabs.length <= 1) {
					if (Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-only-one-tab")) {
						Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-only-one-tab", false);
						if (aDOMWindow.windowState === aDOMWindow.STATE_MAXIMIZED && Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-maximized")) {
							Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-maximized", false);
						} else if (aDOMWindow.windowState === aDOMWindow.STATE_NORMAL && Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-normal")) {
							Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-normal", false);
						} else if (aDOMWindow.windowState === aDOMWindow.STATE_FULLSCREEN && Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-fullscreen")) {
							Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-fullscreen", false);
						}
					} else {
						Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-only-one-tab", true);
					}
				} else {
					switch (aDOMWindow.windowState) {
					case aDOMWindow.STATE_MAXIMIZED: // === 1
						Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-maximized", !Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-maximized"));
						break;
					case aDOMWindow.STATE_NORMAL: // === 3
						Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-normal", !Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-normal"));
						break;
					case aDOMWindow.STATE_FULLSCREEN: // === 4
						Services.prefs.setBoolPref("extensions.tabtree.auto-hide-when-fullscreen", !Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-fullscreen"));
						break;
					}
				}
			}
		}), false);

		aDOMWindow.tt.toRemove.eventListeners.onAppcontentMouseUp = function() {
			quickSearchBox.collapsed = true;
		};

		if (Services.prefs.getBoolPref('extensions.tabtree.search-autohide')) {
			appcontent.addEventListener('mouseup', aDOMWindow.tt.toRemove.eventListeners.onAppcontentMouseUp, false); // don't forget to remove
		}
		//////////////////// END KEY ///////////////////////////////////////////////////////////////////////////////////

//////////////////////////////// here we could load something before all tabs have been loaded and restored by SS ////////////////////////////////

		let tt = {
			DROP_BEFORE: -1,
			DROP_AFTER: 1,

			get nPinned() { // == g._numPinnedTabs
				let c;
				for (c=0; c<g.tabs.length; ++c) {
					if (!g.tabs[c].pinned) {
						break;
					}
				}
				return c;
			},

			hasAnyChildren: function(tPos, gBrowser = g) {
				// `hasAnyChildren` is used when moving tabs between windows
				// so it's very possible that a tab has `gBrowser` from another window:
				let tab = gBrowser.tabs[tPos];
				let lvl = parseInt(ss.getTabValue(tab, "ttLevel"));
				let nextTab = gBrowser.tabs[tPos + 1];
				return !!(!tab.pinned && nextTab && parseInt(ss.getTabValue(nextTab, "ttLevel")) === lvl + 1);
			},

			hasAnySiblings: function(tPos) {
				let level = parseInt(ss.getTabValue(g.tabs[tPos], 'ttLevel'));
				for (let i = tPos-1; i>=0; --i) {
					if (!g.tabs[i]) break;
					if ( parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) == level ) return true;
					if ( parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) < level ) break;
				}
				for (let i = tPos+1; i<g.tabs.length; ++i) {
					if (!g.tabs[i]) break;
					if ( parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) == level ) return true;
					if ( parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) < level ) break;
				}
				return false;
			}, // hasAnySiblings(tPos)

			parentTab: function(aTab) {
				// no checking at all
				for (let i=aTab._tPos-1; i>=0; --i) {
					if (this.levelInt(i)<this.levelInt(aTab)) return g.tabs[i];
				}
				return undefined;
			},

			levelInt: function(aTabOrPos) {
				if (aTabOrPos instanceof Ci.nsIDOMElement) { // if it isn't a number
					return parseInt(ss.getTabValue(aTabOrPos, 'ttLevel'));
				} else {
					return parseInt(ss.getTabValue(g.tabs[aTabOrPos], 'ttLevel'));
				}
			}, // levelInt(aTabOrPos) //

			setLevel: function(aTabOrPos, level) {
				if (aTabOrPos instanceof Ci.nsIDOMElement) { // if it isn't a number
					ss.setTabValue(aTabOrPos, 'ttLevel', level.toString());
				} else {
					ss.setTabValue(g.tabs[aTabOrPos], 'ttLevel', level.toString());
				}
			},

			shiftRight: function(aTab) {
				if (aTab instanceof Ci.nsIDOMElement) {
					ss.setTabValue(aTab, 'ttLevel', (parseInt(ss.getTabValue(aTab, 'ttLevel'))+1).toString() );
				} else {
					ss.setTabValue(g.tabs[aTab], 'ttLevel', (parseInt(ss.getTabValue(g.tabs[aTab], 'ttLevel'))+1).toString() );
				}
			},

			moveTabToPlus: function(aTab, tPosTo, mode) {
				if (aTab.pinned) { // if a pinned tab is being moved from 'toolbar' to 'tree', then unpin it before moving
					g.unpinTab(aTab);
					this.moveTabToPlus(aTab, tPosTo, mode); // recursion
					return;
				}
				
				if (mode===tree.view.DROP_ON) {
					ss.setTabValue(aTab, 'ttLevel', (parseInt(ss.getTabValue(g.tabs[tPosTo], 'ttLevel'))+1).toString());
					for (let i=tPosTo+1; i<g.tabs.length+1; ++i) { // +1 on purpose in order to correctly process adding the tab to the very last position
						// !g.tabs[i] is in order to correctly process adding the tab to the very last postition also
						if ( !g.tabs[i] || parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) <= parseInt(ss.getTabValue(g.tabs[tPosTo], 'ttLevel')) ) {
							if (aTab._tPos > i) {
								g.moveTabTo(aTab, i);
							} else if (aTab._tPos < i) {
								g.moveTabTo(aTab, i-1);
							}
							break;
						}
					}
				} else if (mode===tree.view.DROP_BEFORE) {
					ss.setTabValue(aTab, 'ttLevel', ss.getTabValue(g.tabs[tPosTo], 'ttLevel') );
					if (aTab._tPos > tPosTo) {
						g.moveTabTo(aTab, tPosTo);
					} else if (aTab._tPos < tPosTo) {
						g.moveTabTo(aTab, tPosTo-1);
					}
				} else if (mode===tree.view.DROP_AFTER) {
					if ( this.hasAnyChildren(tPosTo) ) {
						ss.setTabValue(aTab, 'ttLevel', (parseInt(ss.getTabValue(g.tabs[tPosTo], 'ttLevel'))+1).toString());
					} else {
						ss.setTabValue(aTab, 'ttLevel', ss.getTabValue(g.tabs[tPosTo], 'ttLevel') );
					}
					if (aTab._tPos > tPosTo) {
						g.moveTabTo(aTab, tPosTo+1);
					} else if (aTab._tPos < tPosTo) {
						g.moveTabTo(aTab, tPosTo);
					}
				}
			}, // moveTabToPlus: function(aTab, tPosTo, mode)

			moveBranchToPlus: function(aTab, tPosTo, mode) {
				let tPos = aTab._tPos;
				let baseSourceLevel = this.levelInt(aTab);
				if (mode===tree.view.DROP_ON) {
					let baseLevelDiff = this.levelInt(tPos) - (this.levelInt(tPosTo)+1);
					for (let i=tPosTo+1; i<g.tabs.length+1; ++i) { // +1 on purpose in order to correctly process adding the tab to the very last position
						// !g.tabs[i] is in order to correctly process adding the tab to the very last postition also
						if ( !g.tabs[i] || this.levelInt(i)<=this.levelInt(tPosTo) ) { // skip already existing children in the destination tab
							if (tPos>=i) {
								let lastDescendantPos;
								for (lastDescendantPos=tPos+1; lastDescendantPos<g.tabs.length+1; ++lastDescendantPos) { // length+1 on purpose
									if (!g.tabs[lastDescendantPos] || this.levelInt(lastDescendantPos)<=baseSourceLevel) {
										lastDescendantPos = lastDescendantPos-1;
										break;
									}
								}
								while (this.levelInt(lastDescendantPos)>baseSourceLevel) {
									this.setLevel(lastDescendantPos, this.levelInt(lastDescendantPos)-baseLevelDiff);
									g.moveTabTo(g.tabs[lastDescendantPos], i);
								}
								this.setLevel(lastDescendantPos, this.levelInt(lastDescendantPos)-baseLevelDiff); // It must be 'aTab' tab
								g.moveTabTo(g.tabs[lastDescendantPos], i);
							} else if (tPos<i) {
								this.setLevel(tPos, this.levelInt(tPos)-baseLevelDiff);
								g.moveTabTo(g.tabs[tPos], i-1);
								while (this.levelInt(tPos)>baseSourceLevel) {
									this.setLevel(tPos, this.levelInt(tPos)-baseLevelDiff);
									g.moveTabTo(g.tabs[tPos], i-1);
								}
							}
							break;
						}
					}
				} else if (mode===tree.view.DROP_BEFORE) {
					let baseLevelDiff = this.levelInt(tPos) - this.levelInt(tPosTo);
					if (tPos<tPosTo) {
						this.setLevel(tPos, this.levelInt(tPos)-baseLevelDiff);
						g.moveTabTo(g.tabs[tPos], tPosTo-1);
						while (this.levelInt(tPos)>baseSourceLevel) {
							this.setLevel(tPos, this.levelInt(tPos)-baseLevelDiff);
							g.moveTabTo(g.tabs[tPos], tPosTo-1);
						}
					} else if (tPos>tPosTo) {
						let lastDescendantPos;
						for (let i=tPos+1; i<g.tabs.length+1; ++i) { // length+1 on purpose
							if (!g.tabs[i] || this.levelInt(i)<=baseSourceLevel) {
								lastDescendantPos = i-1;
								break;
							}
						}
						while (this.levelInt(lastDescendantPos)>baseSourceLevel) {
							this.setLevel(lastDescendantPos, this.levelInt(lastDescendantPos)-baseLevelDiff);
							g.moveTabTo(g.tabs[lastDescendantPos], tPosTo);
						}
						this.setLevel(lastDescendantPos, this.levelInt(lastDescendantPos)-baseLevelDiff); // It must be 'aTab' tab
						g.moveTabTo(g.tabs[lastDescendantPos], tPosTo);
					}
				} else if (mode===tree.view.DROP_AFTER) {
					let baseLevelDiff = this.levelInt(tPos) - this.levelInt(tPosTo);
					if (this.hasAnyChildren(tPosTo)) {
						--baseLevelDiff;
					}
					if (tPos<tPosTo) {
						this.setLevel(tPos, this.levelInt(tPos)-baseLevelDiff);
						g.moveTabTo(g.tabs[tPos], tPosTo);
						while (this.levelInt(tPos)>baseSourceLevel) {
							this.setLevel(tPos, this.levelInt(tPos)-baseLevelDiff);
							g.moveTabTo(g.tabs[tPos], tPosTo);
						}
					} else if (tPos>tPosTo) {
						let lastDescendantPos;
						for (let i=tPos+1; i<g.tabs.length+1; ++i) { // length+1 on purpose
							if (!g.tabs[i] || this.levelInt(i)<=baseSourceLevel) {
								lastDescendantPos = i-1;
								break;
							}
						}
						while (this.levelInt(lastDescendantPos)>baseSourceLevel) {
							this.setLevel(lastDescendantPos, this.levelInt(lastDescendantPos)-baseLevelDiff);
							g.moveTabTo(g.tabs[lastDescendantPos], tPosTo+1);
						}
						this.setLevel(lastDescendantPos, this.levelInt(lastDescendantPos)-baseLevelDiff); // It must be 'aTab' tab
						g.moveTabTo(g.tabs[lastDescendantPos], tPosTo+1);
					}
				}
			}, // moveBranchToPlus: function(aTab, tPosTo, mode)

			lastDescendantPos: function(aTabOrPos) {
				let ret;
				let tPos = (aTabOrPos instanceof Ci.nsIDOMElement) ? aTabOrPos._tPos : aTabOrPos;
				for (ret = tPos + 1; ret < g.tabs.length + 1; ++ret) { // length+1 on purpose
					if (!g.tabs[ret] || this.levelInt(ret) <= this.levelInt(tPos)) {
						ret = ret - 1;
						break;
					}
				}
				return ret;
			},

			movePinnedToPlus: function(aTab, tPosTo, mode) {
				if (mode === this.DROP_BEFORE) {
					if (aTab._tPos > tPosTo) {
						g.moveTabTo(aTab, tPosTo);
					} else if (aTab._tPos < tPosTo) {
						g.moveTabTo(aTab, tPosTo-1);
					}
				} else if (mode === this.DROP_AFTER) {
					if (aTab._tPos > tPosTo) {
						g.moveTabTo(aTab, tPosTo+1);
					} else if (aTab._tPos < tPosTo) {
						g.moveTabTo(aTab, tPosTo);
					}
				}
				this.redrawToolbarbuttons();
			},

			// It's better to redraw all toolbarbuttons every time then add one toolbarbutton at a time. There were bugs when dragging and dropping them very fast
			redrawToolbarbuttons: function() {
				// reusing existing toolbarbuttons
				let n = toolbar.childNodes.length;
				let max = Math.max(this.nPinned, n);
				let min = Math.min(this.nPinned, n);
				for (let i=0; i<max; ++i) {
					let pinnedtab;
					if (i<min) { // reusing existing toolbarbuttons here
						pinnedtab = toolbar.childNodes[i];
					} else if (this.nPinned > n) { // we added a new pinned tab(tabs)
						pinnedtab = aDOMWindow.document.createElement('ttpinnedtab');
						toolbar.appendChild(pinnedtab);
					} else if (this.nPinned < n) { // we removed a pinned tab(tabs)
						pinnedtab = toolbar.childNodes[i];
						toolbar.removeChild(pinnedtab);
						continue;
					}
					pinnedtab.tab = g.tabs[i]; // The XBL binding takes care of the details now
				}
				g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
				toolbox.collapsed = this.nPinned === 0; /* NEW*/
			}, // redrawToolbarbuttons: function()
			
			quickSearch: function(aText, tPos) {
				// I assume that this method is never invoked with aText=''
				// g.browsers[tPos].contentDocument.URL doesn't work anymore because contentDocument is null
				let url = g.browsers[tPos].documentURI.spec || g.browsers[tPos]._userTypedValue || '';
				let txt = aText.toLowerCase();
				if (g.tabs[tPos].label.toLowerCase().indexOf(txt)!=-1 || url.toLowerCase().indexOf(txt)!=-1) { // 'url.toLowerCase()' may be replaced by 'url'
					return true;
				}
			},
			
			forceReflow: function() {
				/*
				// This function is needed to fix bug #12 (Browser chrome goes blank on some hardware when Firefox hardware acceleration is enabled)
				sidebar.collapsed = true;
				aDOMWindow.setTimeout(function () { sidebar.collapsed = false; }, 400);
				let domWindowUtils = aDOMWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowUtils);
				aDOMWindow.setTimeout(function () { domWindowUtils.redraw(); }, 800);
				// My way to force reflow:
				aDOMWindow.document.documentElement.style.marginLeft = '-1px';
				aDOMWindow.document.documentElement.style.paddingLeft = '1px';
				aDOMWindow.setTimeout(function () {
					aDOMWindow.document.documentElement.style.marginLeft = '';
					aDOMWindow.document.documentElement.style.paddingLeft = '';
				}, 500);
				*/
				// <- It didn't fix bug #12/#53/#2 anyway
			},
			
			moveTabToAnotherWindow: function(draggedTab, newIndex, mode, aDOMWindowTo) {
				// swap the dropped tab with a new one we create and then close
				// it in the other window (making it seem to have moved between
				// windows)
				let newTab = aDOMWindowTo.gBrowser.addTab("about:blank");
				// - after this line `newTab.linkedBrowser.isRemoteBrowser === true` (for e10s of course)
				
				// If we're an e10s browser window, an exception will be thrown
				// if we attempt to drag a non-remote browser in, so we need to
				// ensure that the remoteness of the newly created browser is
				// appropriate for the URL of the tab being dragged in.
				
				// This assumption taken from chrome://browser/content/tabbrowser.xml is wrong
				// because pending (i.e. not restored, yet) tabs always have `false` remoteness regardless of URL
				// and `swapBrowsersAndCloseOther` has line:
				// `if (ourBrowser.isRemoteBrowser != otherBrowser.isRemoteBrowser) return;`
				// so we just copy remoteness from `draggedTab` to `newTab`:
				aDOMWindowTo.gBrowser.updateBrowserRemoteness(newTab.linkedBrowser, draggedTab.linkedBrowser.isRemoteBrowser);
				
				// Stop the about:blank load
				aDOMWindowTo.gBrowser.stop();
				// make sure it has a docshell
				//noinspection BadExpressionStatementJS
				aDOMWindowTo.gBrowser.docShell;
				
				if (newIndex < aDOMWindowTo.gBrowser._numPinnedTabs) {
					aDOMWindowTo.gBrowser.pinTab(newTab);
					tt.movePinnedToPlus(newTab, newIndex, mode);
				} else {
					tt.moveTabToPlus(newTab, newIndex, mode);
				}
				
				// `swapBrowsersAndCloseOther` copies `ttLevel` from `draggedTab` and overrides correct `ttLevel`
				// so let's remember and restore our `ttLevel`:
				let lvl = tt.levelInt(newTab);
				aDOMWindowTo.gBrowser.swapBrowsersAndCloseOther(newTab, draggedTab);
				tt.setLevel(newTab, lvl);
				
				return newTab;
			},
			
			moveBranchToAnotherWindow: function(tab, newIndex, mode, aDOMWindowTo) {
				let oldIndex = tab._tPos;
				let oldG = tab.ownerDocument.defaultView.gBrowser;
				let oldLevel = parseInt(ss.getTabValue(tab, "ttLevel"));
				let lastChildPos = oldG.tabs.length - 1;
				for (let i=oldIndex+1; oldG.tabs[i]; ++i) {
					if (parseInt(ss.getTabValue(oldG.tabs[i], "ttLevel")) <= oldLevel) {
						lastChildPos = i - 1;
						break;
					}
				}
				let levelTo = parseInt(ss.getTabValue(aDOMWindowTo.gBrowser.tabs[newIndex], "ttLevel"));
				
				if (mode === tree.view.DROP_ON) {
					let newLevels = [];
					for (let i = oldIndex; i <= lastChildPos; ++i) {
						newLevels.push(levelTo + (parseInt(ss.getTabValue(oldG.tabs[i], "ttLevel")) - oldLevel) + 1);
					}
					for (let i = 0; i <= lastChildPos - oldIndex; ++i) {
						let newTab = tt.moveTabToAnotherWindow(oldG.tabs[oldIndex], newIndex, tree.view.DROP_ON, aDOMWindow);
						ss.setTabValue(newTab, "ttLevel", newLevels[i].toString());
					}
				} else if (mode === tree.view.DROP_BEFORE) {
					let newLevels = [];
					for (let i = oldIndex; i <= lastChildPos; ++i) {
						newLevels.push(levelTo + (parseInt(ss.getTabValue(oldG.tabs[i], "ttLevel")) - oldLevel));
					}
					for (let i = 0; i <= lastChildPos - oldIndex; ++i) {
						let newTab = tt.moveTabToAnotherWindow(oldG.tabs[oldIndex], newIndex + i, tree.view.DROP_BEFORE, aDOMWindow);
						ss.setTabValue(newTab, "ttLevel", newLevels[i].toString());
					}
				} else if (mode === tree.view.DROP_AFTER) {
					for (let i = lastChildPos; i >= oldIndex; --i) {
						let newLevel = levelTo + (parseInt(ss.getTabValue(oldG.tabs[i], "ttLevel")) - oldLevel);
						let newTab = tt.moveTabToAnotherWindow(oldG.tabs[i], newIndex, tree.view.DROP_AFTER, aDOMWindow);
						ss.setTabValue(newTab, "ttLevel", newLevel.toString());
					}
				}
			},
			
			duplicateTab: function (tab, lvl, posTo) {
				// `gBrowser.duplicateTab()` is asynchronous and uses SS to do the work
				// so we have to wait a bit to ensure "ttLevel" is correct:
				let newTab = g.duplicateTab(tab);
				newTab.addEventListener("SSTabRestoring", function onSSTabRestoring(event) {
					newTab.removeEventListener("SSTabRestoring", onSSTabRestoring, false);
					
					if (posTo) {
						g.moveTabTo(newTab, posTo);
					}
					ss.setTabValue(newTab, "ttLevel", lvl.toString());
					g.selectedTab = newTab;
					tree.treeBoxObject.invalidate();
				}, false);
			},
		}; // let tt =

		treechildren.addEventListener('dragstart', function(event) { // if the event was attached to 'tree' then the popup would be shown while you scrolling
			event.dataTransfer.effectAllowed = "copyMove";
			let tab = g.tabs[tree.currentIndex+tt.nPinned];
			event.dataTransfer.mozSetDataAt(aDOMWindow.TAB_DROP_TYPE, tab, 0);
			// "We must not set text/x-moz-url or text/plain data here,"
			// "otherwise trying to detach the tab by dropping it on the desktop"
			// "may result in an "internet shortcut" // from tabbrowser.xml
			event.dataTransfer.mozSetDataAt("text/x-moz-text-internal", tab.linkedBrowser.currentURI.spec, 0);

			if (1 || tt.hasAnyChildren(tab._tPos)) { // remove "1" to use default feedback image for a single row
				treecolDragFeedback.closebtn.collapsed = !Services.prefs.getBoolPref('extensions.tabtree.close-tab-buttons');
				//noinspection JSUnusedGlobalSymbols
				dragFeedbackTree.treeBoxObject.view = {
					numStart: tab._tPos,
					numEnd: tt.lastDescendantPos(tab._tPos),
					treeBox: null,
					selection: null,
					setTree: function (treeBox) {
						this.treeBox = treeBox;
					},
					get rowCount() {
						return this.numEnd - this.numStart + 1;
					},
					getCellText: function (row, column) {
						if (column.index !== TT_COL_TITLE) {
							return '';
						}
						let tPos = row + this.numStart;
						return ' ' + g.tabs[tPos].label;
					},
					getImageSrc: function (row, column) {
						if (column.index !== TT_COL_TITLE) {
							return '';
						}
						let tPos = row + this.numStart;
						return g.tabs[tPos].image;
					}, // or null to hide icons or /g.getIcon(g.tabs[row])/
					isContainer: function (row) {
						return true;
					}, // drop can be performed only on containers
					isContainerOpen: function (row) {
						return true;
					},
					isContainerEmpty: function (row) {
						let tPos = row + this.numStart;
						return !tt.hasAnyChildren(tPos);
					},
					getLevel: function (row) {
						let tPos = row + this.numStart;
						return parseInt(ss.getTabValue(g.tabs[tPos], 'ttLevel'));
					},
					isSeparator: function (row) {
						return false;
					},
					isSorted: function () {
						return false;
					},
					isEditable: function (row, column) {
						return false;
					},
					getParentIndex: function (row) {
						if (this.getLevel(row) == 0) return -1;
						for (let t = row - 1; t >= 0; --t) {
							if (this.getLevel(t) < this.getLevel(row)) return t; // && this.isContainerEmpty(t)
						}
						return -1;
					},
					hasNextSibling: function (row, after) {
						let thisLevel = this.getLevel(row);
						for (let t = after + 1; t < this.rowCount; t++) {
							let nextLevel = this.getLevel(t);
							if (nextLevel == thisLevel) return true;
							if (nextLevel < thisLevel) break;
						}
						return false;
					},
					getCellProperties: function(row, col) {
						switch (col.index) {
							case TT_COL_CLOSE:
								return 'tt-close';

							case TT_COL_OVERLAY:
								if (tab.hasAttribute('muted')) {
									return 'tt-muted';
								} else if (tab.hasAttribute('soundplaying')) {
									return 'tt-soundplaying';
								} else {
									return 'tt-overlay';
								}
						}
					}
				};
				dragFeedbackTree.style.width = tree.getBoundingClientRect().width + 'px';
				let borderTopWidth = parseFloat( aDOMWindow.getComputedStyle(dragFeedbackTree).getPropertyValue('border-top-width') );
				let borderBottomWidth = parseFloat( aDOMWindow.getComputedStyle(dragFeedbackTree).getPropertyValue('border-bottom-width') );
				let dragFeedbackTreeHeight = dragFeedbackTree.treeBoxObject.rowHeight * dragFeedbackTree.treeBoxObject.view.rowCount;
				dragFeedbackTree.style.height = dragFeedbackTreeHeight + borderTopWidth + borderBottomWidth + 'px';
				event.dataTransfer.setDragImage(dragFeedbackTree, event.clientX-tree.getBoundingClientRect().x, -20);
			}
			// uncomment if you always want to highlight 'gBrowser.mCurrentTab':
			//g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
			event.stopPropagation();
		}, false); // treechildren.addEventListener('dragstart', function(event)
		
		treechildren.addEventListener("drop", function(event) {
			// This event listener fires before tree.view.drop()
			// save `event` because tree.view.drop() doesn't have `event` parameter and use it later:
			aDOMWindow.tt.dropEvent = event;
		}, false);
		
		tree.addEventListener('dragend', function(event) {
			if (event.dataTransfer.dropEffect == 'none') { // the drag was cancelled
				g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
			}
		}, false);

		// #71 Feature request: Import tree structure from TST on first run
		// If it's the first run and there was TST installed before
		if (ss.getTabValue(g.tabs[0], "ttLevel") === "" && ss.getTabValue(g.tabs[0], "treestyletab-id")) {
			let tabsByTSTId = {};
			for (let tab of g.tabs) {
				tabsByTSTId[ss.getTabValue(tab, "treestyletab-id")] = tab;
			}
			let getTSTLvl  = (tab) => {
				let parentId = ss.getTabValue(tab, "treestyletab-parent");
				if (parentId) {
					return getTSTLvl(tabsByTSTId[parentId]) + 1;
				} else {
					return 0;
				}
			};
			for (let tab of g.tabs) {
				ss.setTabValue(tab, "ttLevel", getTSTLvl(tab).toString());
			}
		} else {
			for (let tab of g.tabs) {
				if (ss.getTabValue(tab, "ttLevel") === "") {
					ss.setTabValue(tab, "ttLevel", "0");
				}
			}
		}

		aDOMWindow.tt.toRestore.g.addTab = g.addTab;
		g.addTab = new Proxy(g.addTab, {
			apply: function(target, thisArg, argumentsList) {
				if (Services.prefs.getBoolPref('extensions.tabtree.search-autohide')) {
					quickSearchBox.collapsed = true;
				}
				
				let fromVimFx = false; // #73 (Be more compatible with keyboard-oriented addons such as VimFx)
				// altering params.relatedToCurrent argument in order to ignore about:config insertRelatedAfterCurrent option:
				if (argumentsList.length == 2 && typeof argumentsList[1] == "object" && !(argumentsList[1] instanceof Ci.nsIURI)) {
					fromVimFx = argumentsList[1].relatedToCurrent;
					argumentsList[1].relatedToCurrent = false;
					argumentsList[1].skipAnimation = true; // I believe after disabling animation tabs are added a little bit faster
					// But I can't see the difference with the naked eye
				}
				
				if (argumentsList.length>=2 && (argumentsList[1].referrerURI || fromVimFx)) { // undo close tab hasn't got argumentsList[1]
					g.tabContainer.addEventListener('TabOpen', function onPreAddTabWithRef(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddTabWithRef, true);
						let tab = event.target;
						let oldTab = g.selectedTab;
						let insertRelatedAfterCurrent = Services.prefs.getBoolPref('extensions.tabtree.insertRelatedAfterCurrent');
						if (oldTab.pinned) {
							ss.setTabValue(tab, 'ttLevel', '0');
							tree.treeBoxObject.rowCountChanged(g.tabs.length-1 - tt.nPinned, 1); // our new tab is at index g.tabs.length-1
							if (insertRelatedAfterCurrent) {
								g.moveTabTo(g.tabs[g.tabs.length-1], tt.nPinned);
							}
						} else {
							let lvl = parseInt(ss.getTabValue(oldTab, 'ttLevel')) + 1;
							let maxLvl = Services.prefs.getIntPref('extensions.tabtree.max-indent');
							let i;
							if (maxLvl !== -1 && lvl > maxLvl) {
								lvl = maxLvl;
							}
							ss.setTabValue(tab, 'ttLevel', lvl.toString());

							for (i = oldTab._tPos + 1; i < g.tabs.length - 1; ++i) { // the last is our new tab
								if (insertRelatedAfterCurrent || parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) < lvl) {
									g.moveTabTo(tab, i);
									break;
								}
							}

							tree.treeBoxObject.rowCountChanged(i - tt.nPinned, 1);
							// now we need to do something with a selected tree row(it has moved due to a newly added tab, it is not obvious why)
							// it only needed if we opened a new tab in background and not from a pinned tab:
							tree.view.selection.select(oldTab._tPos - tt.nPinned);
							tree.treeBoxObject.invalidate(); // it's really needed to correctly draw the nesting lines alongside the tree
						}
						tree.treeBoxObject.ensureRowIsVisible(tab._tPos - tt.nPinned);
					}, true);
				} else if ( // new tab button or dropping links on the native tabbar or (NEW) gBrowser.addTab() when called without arguments
					argumentsList.length>=2 && !argumentsList[1].referrerURI ||
					argumentsList.length===1 ||
					argumentsList.length===0 && !aDOMWindow.ttIsRestoringTab
				) {
					g.tabContainer.addEventListener('TabOpen', function onPreAddTabWithoutRef(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddTabWithoutRef, true);
						if ( ss.getTabValue(event.target, 'ttLevel') === '' ) {
							ss.setTabValue(event.target, 'ttLevel', '0');
						}
						tree.treeBoxObject.rowCountChanged(event.target._tPos-tt.nPinned, 1);
					}, true);
				} else { // undo close tab
					delete aDOMWindow.ttIsRestoringTab;
					g.tabContainer.ttUndoingCloseTab = true; // for 'TabSelected' event handler in order not to fire when it is unnecessary
					g.tabContainer.addEventListener('TabOpen', function onPreAddUndoCloseTab(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddUndoCloseTab, true);
						aDOMWindow.document.addEventListener('SSTabRestoring', function onSSing(event) {
							aDOMWindow.document.removeEventListener('SSTabRestoring', onSSing, true);
							let tab = event.originalTarget; // the tab being restored
							if (tab.pinned) {
								tt.redrawToolbarbuttons();
							} else {
								tree.treeBoxObject.rowCountChanged(tab._tPos - tt.nPinned, 1);
								// refresh the twisty (commented out while the twisty is disabled):
								//let pTab = tt.parentTab(tab);
								//if (pTab)
								//	tree.treeBoxObject.invalidateRow(pTab._tPos - tt.nPinned);
								//}

								if (ss.getTabValue(tab, 'ttSS')) { // if tab had direct children, then make them children again
									let arr = JSON.parse(ss.getTabValue(tab, 'ttSS'));
									tt.shiftRight(tab._tPos + 1);
									for (let i = tab._tPos + 2; i < g.tabs.length; ++i) { // +2 on purpose
										if (tt.levelInt(i) <= tt.levelInt(tab)) {
											break;
										}
										if (tt.levelInt(i) == tt.levelInt(tab) + 1) {
											if (arr.indexOf(g.tabs[i].linkedPanel) == -1) {
												tt.shiftRight(i);
											}
										} else {
											tt.shiftRight(i);
										}
									}
									ss.deleteTabValue(tab, 'ttSS');
								}

								tree.view.selection.select(tab._tPos - tt.nPinned); // after 'rowCountChanged' the selected row is moved 1 position ahead
								tree.treeBoxObject.ensureRowIsVisible(tab._tPos - tt.nPinned);
							}
						}, true);
					}, true);
				}
				return target.apply(thisArg, argumentsList);
			}
		}); // don't forget to restore

		aDOMWindow.tt.toRestore.g._endRemoveTab = g._endRemoveTab;
		g._endRemoveTab = new Proxy(g._endRemoveTab, {
			apply: function(target, thisArg, argumentsList) {
				let tPos = argumentsList[0]._tPos;
				let tab = argumentsList[0];
				let pinned = false;
				if (tab.pinned) { // if we are closing a pinned tab then remember it
					pinned = true;
				} else if ( tt.hasAnyChildren(tPos) ) { // if we are closing a parent then make the first child a new parent
					// for SS we need to save the direct children
					let arr = [];
					for (let i=tPos+1; i<g.tabs.length; ++i) {
						if ( tt.levelInt(i) <= tt.levelInt(tPos) ) {
							break;
						}
						if ( tt.levelInt(i) == tt.levelInt(tPos)+1 ) {
							arr.push(g.tabs[i].linkedPanel);
						}
					}
					ss.setTabValue(tab, 'ttSS', JSON.stringify(arr));
					// end for SS
					for (let i=tPos+2; i<g.tabs.length; ++i) {
						if ( g.tabs[i]	&& parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) > parseInt(ss.getTabValue(g.tabs[tPos+1], 'ttLevel')) ) {
							ss.setTabValue(g.tabs[i], 'ttLevel', (parseInt(ss.getTabValue(g.tabs[i], 'ttLevel'))-1).toString());
						} else {
							break;
						}
					}
					ss.setTabValue(g.tabs[tPos+1], 'ttLevel', (parseInt(ss.getTabValue(g.tabs[tPos+1], 'ttLevel'))-1).toString());
				} else if ( parseInt(ss.getTabValue(tab, 'ttLevel'))>=1 && !tt.hasAnySiblings(tPos) ) { // closing the last child, the first condition may be omitted, for now
					let pTab = tt.parentTab(tab);
					tree.treeBoxObject.invalidateRow(pTab._tPos-tt.nPinned);
				}

				target.apply(thisArg, argumentsList); // returns nothing // after this, "tab.pinned" is always 'false' therefore we use "pinned" which we prepared early
				
				if (pinned) {
					tt.redrawToolbarbuttons();
				} else {
					tree.treeBoxObject.rowCountChanged(tPos - tt.nPinned, -1);
					g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
				}
			}
		}); // don't forget to restore

		let prefPending = Services.prefs.getIntPref('extensions.tabtree.highlight-unloaded-tabs');
		let prefUnread = Services.prefs.getBoolPref('extensions.tabtree.highlight-unread-tabs');
		
		//noinspection JSUnusedGlobalSymbols
		let view = {
			treeBox: null,
			selection: null,
			setTree: function(treeBox) { this.treeBox = treeBox; },
			get rowCount() {
				return g.tabs.length-tt.nPinned;
			},
			getCellText: function(row, column) {
				if (column.index !== TT_COL_TITLE) {
					return ''; // If a column consists only of an image, then the empty string is returned.
				}
				let tPos = row+tt.nPinned;
				return (tabNumbers ? `(${row + g._numPinnedTabs + 1}) ` : " ") + g.tabs[tPos].label;
				// tabNumbers === Services.prefs.getBoolPref("extensions.tabtree.tab-numbers")
				// the pref is cached for better performance
			},
			getImageSrc: function(row, column) {
				if (column.index !== TT_COL_TITLE) {
					return ''; // "If the empty string is returned, the ::moz-tree-image pseudoelement will be used."
				}
				
				// Notice that when 'busy' attribute has already been removed the favicon can still be not loaded
				let tPos = row+tt.nPinned;
				let tab = g.tabs[tPos];
				if ('ttThrobC' in tab) {
					if (tab.hasAttribute('progress') && tab.hasAttribute('busy')) {
						return 'chrome://tabtree/skin/loading-F' + tab.ttThrobC + '.png';
					} else if (tab.hasAttribute('busy')) {
						return 'chrome://tabtree/skin/connecting-F' + tab.ttThrobC + '.png';
					} else {
						// we can also clear this Interval in 'TabAttrModified' event listener
						aDOMWindow.clearInterval(tab.ttThrob);
						delete tab.ttThrobC;
						delete tab.ttThrob;
					}
				}
				
				// Firefox uses <xul:image> instead of <img>. <xul:image> doesn't have '.complete' property
				// And I don't know any other way to determine whether an image was loaded or not.
				// If I just wrote "return g.tabs[tPos].image;" then there would be a small period of time when
				// a page is already loaded (and attribute 'busy' removed), but the favicon is still loading and
				// in that period of time a row wouldn't have any icon and for user it would look like a tab title jumping to the left for a split of a second
				
				// tab.image and tab.getAttribute("image") add "#-moz-resolution=16,16" to the end of iconURL (but not always)
				// browser.mIconURL and g.getIcon(aTab) don't add anything
				
				// tab.image/tab.getAttribute("image") and browser.mIconURL/g.getIcon(aTab) behave different when accessing tabs without favicons
				// the former returns "" for such tabs
				// the latter returns null for such tabs as "new tab" and "about:config"
				// but for tabs with ordinary web sites without favicons it returns something like "http://www.site-without-favicon.com/favicon.ico"
				
				// adding "#-moz-resolution=16,16" to the end of an image src does wonders
				// so I decided to throw away "new Image()" and "if (im.complete)" staff due to bug #69 (Gif animations don’t animate)
				
				if (tab.image) {
					return g.getIcon(tab) + "#-moz-resolution=16,16";
				} else {
					return "chrome://mozapps/skin/places/defaultFavicon.png";
					// since about FF47 g.mFaviconService is undefined
					// g.mFaviconService.defaultFavicon.spec is "chrome://mozapps/skin/places/defaultFavicon.png"
					// Or we could return something like 'chrome://tabtree/skin/completelyTransparent.png'
					// in that case it would look exactly like what Firefox does for its default tabs
				}
				
				// using animated png's causes abnormal CPU load (due to too frequent rows invalidating)
				// and until this Firefox bug is fixed the following code will be commented out:
				//if (g.tabs[tPos].hasAttribute('progress') && g.tabs[tPos].hasAttribute('busy')) {
				//	return "chrome://global/skin/icons/loading.png";
				//} else if (g.tabs[tPos].hasAttribute('busy')) {
				//	return "chrome://browser/skin/tabbrowser/connecting.png";
				//}
				//return g.tabs[tPos].image;
			}, // or null to hide icons or /g.getIcon(g.tabs[tPos])/
			isContainer: function(row) { return true; }, // drop can be performed only on containers
			isContainerOpen: function(row) { return true; },
			isContainerEmpty: function(row) {
				let tPos = row+tt.nPinned;
				return !tt.hasAnyChildren(tPos);
			},
			getLevel: function(row) {
				let tPos = row+tt.nPinned;
				return parseInt(ss.getTabValue(g.tabs[tPos], 'ttLevel'));
			},
			isSeparator: function(row) { return false; },
			isSorted: function() { return false; },
			isEditable: function(row, column) { return false; },
			getRowProperties: function(row) {
				if (quickSearchBox.value==='' || quickSearchBox.collapsed) {
					return;
				}
				let tPos = row+tt.nPinned;
				if ( tt.quickSearch(quickSearchBox.value, tPos) ) {
					return 'quickSearch';
				}
			},
			getCellProperties: function(row, col) {
				let tPos = row+tt.nPinned;
				let tab = g.tabs[tPos];
				let ret = '';

				switch (col.index) {
					case TT_COL_CLOSE:
						return 'tt-close';

					case TT_COL_OVERLAY:
						ret = 'tt-overlay';
						if (tab.hasAttribute('muted'))
							ret += ' tt-muted';
						else if (tab.hasAttribute('soundplaying'))
							ret += ' tt-soundplaying';
						return ret;
				}

				// Default column is the tab title, TT_COL_TITLE
				if (prefPending && tab.hasAttribute('pending')) {
					switch (prefPending) {
						case 1:
							ret += ' pending-grayout';
							break;
						case 2:
							ret += ' pending-highlight';
							break;
					}
				}
				if (prefUnread && tab.hasAttribute('unread')) {
					ret += ' unread';
				}
				if (tab.hasAttribute('busy')) {
					ret += ' busy'
				}
				if (tab.hasAttribute('progress')) {
					ret += ' progress'
				}
				return ret;
			},
			//getColumnProperties: function(colid,col,props){} // props parameter is obsolete since Gecko 22
			getParentIndex: function(row) {
				if (this.getLevel(row)==0) return -1;
				for (let t = row - 1; t >= 0; --t) {
					if (this.getLevel(t)<this.getLevel(row)) return t; // && this.isContainerEmpty(t)
				}
				return -1;
			},
			hasNextSibling: function(row, after) {
				let thisLevel = this.getLevel(row);
				for (let t = after + 1; t < this.rowCount; t++) {
					let nextLevel = this.getLevel(t);
					if (nextLevel == thisLevel) return true;
					if (nextLevel < thisLevel) break;
				}
				return false;
			},
			toggleOpenState: function(row) {
				//this.treeBox.invalidateRow(row);
			},
			canDrop: function(index, orientation, dataTransfer) {
				let tPos = index + tt.nPinned;

				if (dataTransfer.mozTypesAt(0)[0] === aDOMWindow.TAB_DROP_TYPE) { // TAB_DROP_TYPE should be always at [0]
					let draggedTab = dataTransfer.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0); // undefined for links
					if (draggedTab.parentNode == g.tabContainer) { // if it's the same window
						// for leaves:
						if (draggedTab != g.tabs[tPos] && !tt.hasAnyChildren(draggedTab._tPos)) { // can't be dropped on itself
							return true;
						}

						// for branches:
						if (draggedTab != g.tabs[tPos]) {
							let i;
							for (i = draggedTab._tPos + 1; i < g.tabs.length; ++i) {
								if (tt.levelInt(i) <= tt.levelInt(draggedTab)) {
									break;
								}
							}
							if (tPos < draggedTab._tPos || tPos >= i) {
								return true;
							}
						}
					} else {
						// Enabling drag and drop tabs to another window
						// Firefox can't move tabs from e10s to non-e10s windows and vice versa
						return draggedTab.ownerDocument.defaultView.gMultiProcessBrowser === aDOMWindow.gMultiProcessBrowser;
						// Although it's possible to do moving pending and about:x tabs between any types of windows
						// But I doubt it's worth the trouble
					}
				}
				
				// for links:
				//noinspection RedundantIfStatementJS
				if (dataTransfer.mozTypesAt(0).contains('text/uri-list')) {
					return true;
				}

				return false;
			},
			drop: function(row, orientation, dt) {
				let tPosTo = row + tt.nPinned;
				
				let dropEffect = dt.dropEffect;
				let draggedTab;
				if (dt.mozTypesAt(0)[0] == aDOMWindow.TAB_DROP_TYPE) { // tab copy or move
					draggedTab = dt.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0);
					// not our drop then
					if (!draggedTab) {
						return;
					}
				}
				
				if (draggedTab && dropEffect == "copy") {
					// copy the dropped tab (wherever it's from)
					// #39 Ctrl+drag to duplicate tab
					// It duplicates only one tab despite a drag feedback that can represent a subtree
					let newTab = g.duplicateTab(draggedTab);
					// `duplicateTab()` is asynchronous and uses SS to do the work
					// so we have to wait before moving a tab to ensure that "ttLevel" is correct:
					let shift = aDOMWindow.tt.dropEvent.shiftKey;
					newTab.addEventListener("SSTabRestoring", function onSSTabRestoring(event) {
						newTab.removeEventListener("SSTabRestoring", onSSTabRestoring, false);
						tt.moveTabToPlus(newTab, tPosTo, orientation);
						if (shift) {
							g.tabContainer.selectedItem = newTab;
						}
						tree.treeBoxObject.invalidate();
					}, false);
				}  else if (draggedTab && draggedTab.parentNode == g.tabContainer) {
					// Here moving tab/tabs in one window
					if (tt.hasAnyChildren(draggedTab._tPos)) {
						tt.moveBranchToPlus(draggedTab, tPosTo, orientation);
					} else {
						tt.moveTabToPlus(draggedTab, tPosTo, orientation);
					}
				} else if (draggedTab) {
					// Here moving tab/tabs between two windows
					if (tt.hasAnyChildren(draggedTab._tPos, draggedTab.parentNode.tabbrowser)) {
						tt.moveBranchToAnotherWindow(draggedTab, tPosTo, orientation, aDOMWindow);
					} else {
						tt.moveTabToAnotherWindow(draggedTab, tPosTo, orientation, aDOMWindow);
					}
				} else {
					// Here we dropping links
					// Pass true to disallow dropping javascript: or data: urls
					let url;
					try {
						url = aDOMWindow.browserDragAndDrop.drop(aDOMWindow.tt.dropEvent, {}, true);
					} catch (ex) {
					}
					if (!url) {
						return;
					}
					let bgLoad = Services.prefs.getBoolPref("browser.tabs.loadInBackground");
					if (aDOMWindow.tt.dropEvent.shiftKey) {
						bgLoad = !bgLoad;
					}
					// We're adding a new tab.
					let newTab = g.loadOneTab(url, {inBackground: bgLoad, allowThirdPartyFixup: true});
					tt.moveTabToPlus(newTab, tPosTo, orientation);
				}
				g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
				delete aDOMWindow.tt.dropEvent;
			},
		}; // let view =
		tree.view = view;

		aDOMWindow.tt.toRestore.g.pinTab = g.pinTab;
		g.pinTab = new Proxy(g.pinTab, {
			apply: function(target, thisArg, argumentsList) {
				let tab = argumentsList[0];
				// #27 (Some tabs are missing when Firefox isn't properly closed and the session is restored using the built-in Session Manager)
				// if we are pinning an already pinned tab or - #27
				// if there is no information about 'ttLevel' then it means SS is calling gBrowser.pinTab(newlyCreatedEmptyTab)
				if (tab.pinned || ss.getTabValue(tab, 'ttLevel') == '') {
					target.apply(thisArg, argumentsList); // dispatches 'TabPinned' event, returns nothing
					return; // then just do nothing
				}
				let tPos = argumentsList[0]._tPos;
				if ( tt.hasAnyChildren(tPos) ) { // if we are pinning a parent then make the first child a new parent
					for (let i=tPos+2; i<g.tabs.length; ++i) {
						if ( g.tabs[i] && parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) > parseInt(ss.getTabValue(g.tabs[tPos+1], 'ttLevel')) ) {
							ss.setTabValue(g.tabs[i], 'ttLevel', (parseInt(ss.getTabValue(g.tabs[i], 'ttLevel'))-1).toString());
						} else {
							break;
						}
					}
					ss.setTabValue(g.tabs[tPos+1], 'ttLevel', (parseInt(ss.getTabValue(g.tabs[tPos+1], 'ttLevel'))-1).toString());
				} else if ( parseInt(ss.getTabValue(tab, 'ttLevel'))>=1 && !tt.hasAnySiblings(tPos)) { // closing the last child, the first condition may be omitted, for now
					let pTab = tt.parentTab(tab);
					tree.treeBoxObject.invalidateRow(pTab._tPos-tt.nPinned); // needed for twisty
				}

				g.tabContainer.addEventListener("TabPinned", function onTabPinned(event) {
					g.tabContainer.removeEventListener("TabPinned", onTabPinned, false);
					
					tt.redrawToolbarbuttons();
				}, false);

				let row = tPos-tt.nPinned; // remember the row because after target.apply the number of pinned tabs will change(+1) and result would be different
				target.apply(thisArg, argumentsList); // dispatches 'TabPinned' event, returns nothing
				tree.treeBoxObject.rowCountChanged(row, -1);

				// Hiding TT_COL_OVERLAY column when there's no at least 1 audio indicator and vice versa 
				// Duplicate this code in onTabAttrModified, pinTab and unpinTab
				treecol.overlay.collapsed = !Array.some(g.tabs, (x) => !x.pinned && (x.hasAttribute('muted') || x.hasAttribute('soundplaying')));
			}
		}); // don't forget to restore

		aDOMWindow.tt.toRestore.g.unpinTab = g.unpinTab;
		g.unpinTab = new Proxy(g.unpinTab, {
			apply: function(target, thisArg, argumentsList) {
				if (argumentsList.length>0 && argumentsList[0] && argumentsList[0].pinned) { // It seems SS invokes gBrowser.unpinTab for every tab(pinned and not pinned)
					let tab = argumentsList[0];

					ss.setTabValue(tab, 'ttLevel', '0');

					g.tabContainer.addEventListener("TabUnpinned", function onTabUnpinned(event) {
						g.tabContainer.removeEventListener("TabUnpinned", onTabUnpinned, false);

						let tPos = event.target._tPos;
						tt.redrawToolbarbuttons();
						tree.treeBoxObject.rowCountChanged(tPos - tt.nPinned, 1); // the first argument is always 0
						//tree.treeBoxObject.ensureRowIsVisible(tab._tPos - tt.nPinned); // questionable option, I think I should leave it out
					}, false);
				}
				target.apply(thisArg, argumentsList); // returns nothing // dispatches 'TabUnpinned' event

				// Hiding TT_COL_OVERLAY column when there's no at least 1 audio indicator and vice versa
				// Duplicate this code in onTabAttrModified, pinTab and unpinTab
				treecol.overlay.collapsed = !Array.some(g.tabs, (x) => !x.pinned && (x.hasAttribute('muted') || x.hasAttribute('soundplaying')));
			}
		}); // don't forget to restore

		toolbar.addEventListener('dragstart', function(event) {
			event.dataTransfer.effectAllowed = "copyMove";
			let toolbarbtn = event.originalTarget;
			let tPos = toolbarbtn.tPos; // See bindings.xml
			let tab = g.tabs[tPos];
			event.dataTransfer.mozSetDataAt(aDOMWindow.TAB_DROP_TYPE, tab, 0);
			event.dataTransfer.mozSetDataAt('application/x-moz-node', toolbarbtn, 0);
			event.dataTransfer.mozSetDataAt('text/x-moz-text-internal', tab.linkedBrowser.currentURI.spec, 0);
			event.stopPropagation();
		}, false);

		toolbar.addEventListener('dragover', (event) => {
			let dt = event.dataTransfer;
			let ot = event.originalTarget;
			
			// Forbid moving tabs from e10s to non-e10s and vice versa
			// although it's possible to do moving pending and about:x tabs between any types of windows
			// but I doubt it's worth the trouble:
			if (dt.mozTypesAt(0)[0] == aDOMWindow.TAB_DROP_TYPE) { // tab copy or move
				let draggedTab = dt.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0);
				// not our drop then
				if (!draggedTab || draggedTab.ownerDocument.defaultView.gMultiProcessBrowser !== aDOMWindow.gMultiProcessBrowser) {
					return;
				}
			}
			
			if ((dt.mozTypesAt(0).contains(aDOMWindow.TAB_DROP_TYPE) || dt.mozTypesAt(0).contains('text/uri-list')) &&
				 dt.mozGetDataAt("application/x-moz-node", 0) !== ot
			) {
				event.preventDefault();
				event.stopPropagation();

				let x;
				let y;
				if (ot.localName === "toolbarbutton") {
					if (event.screenX <= ot.boxObject.screenX + ot.boxObject.width / 2) {
						x = ot.boxObject.screenX - toolbar.boxObject.screenX;
					} else {
						x = ot.boxObject.screenX + ot.boxObject.width - toolbar.boxObject.screenX;
					}
					y = ot.boxObject.screenY - toolbar.boxObject.screenY;
				} else { // ot.localName === "toolbar"
					x = toolbar.lastChild.boxObject.screenX - toolbar.boxObject.screenX + toolbar.lastChild.boxObject.width;
					y = toolbar.lastChild.boxObject.screenY - toolbar.boxObject.screenY;
				}
				dropIndicator.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
				dropIndicator.collapsed = false;
			}
		}, false);

		toolbar.addEventListener('dragleave', function f(event) {
			event.preventDefault();
			event.stopPropagation();

			dropIndicator.collapsed = true;
		}, false);

		toolbar.addEventListener("drop", function onDrop(event) {
			let dt = event.dataTransfer;
			let dropEffect = dt.dropEffect;
			let draggedTab;
			if (dt.mozTypesAt(0)[0] == aDOMWindow.TAB_DROP_TYPE) { // tab copy or move
				draggedTab = dt.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0);
				// not our drop then
				if (!draggedTab) {
					return;
				}
			}
			let newIndex = g._numPinnedTabs - 1;
			let orientation = tt.DROP_AFTER;
			if (event.originalTarget.localName === "toolbarbutton") {
				newIndex = event.originalTarget.tPos; // see bindings.xml
				if (event.screenX <= event.originalTarget.boxObject.screenX + event.originalTarget.boxObject.width / 2) {
					orientation = tt.DROP_BEFORE;
				} else {
					orientation = tt.DROP_AFTER;
				}
			}
			
			if (draggedTab && dropEffect == "copy") {
				// copy the dropped tab (wherever it's from)
				// #39 Ctrl+drag to duplicate tab
				// It duplicates only one tab despite a drag feedback that can represent a subtree
				let newTab = g.duplicateTab(draggedTab);
				// `duplicateTab()` is asynchronous and uses SS to do the work
				// so we have to wait before moving a tab to ensure that "ttLevel" is correct:
				let shift = event.shiftKey;
				newTab.addEventListener("SSTabRestoring", function onSSTabRestoring(event) {
					newTab.removeEventListener("SSTabRestoring", onSSTabRestoring, false);
					g.pinTab(newTab);
					tt.movePinnedToPlus(newTab, newIndex, orientation);
					if (shift) {
						g.tabContainer.selectedItem = newTab;
					}
					tree.treeBoxObject.invalidate();
					tt.redrawToolbarbuttons();
				}, false);
			}  else if (draggedTab && draggedTab.parentNode == g.tabContainer) {
				// Here dropping a tab from the same window
				g.pinTab(draggedTab);
				tt.movePinnedToPlus(draggedTab, newIndex, orientation);
			} else if (draggedTab) {
				// Here dropping a tab from another window
				draggedTab.parentNode.tabbrowser.pinTab(draggedTab);
				tt.moveTabToAnotherWindow(draggedTab, newIndex, orientation, aDOMWindow);
			} else {
				// Here dropping links
				// Pass true to disallow dropping javascript: or data: urls
				let url;
				try {
					url = aDOMWindow.browserDragAndDrop.drop(event, {}, true);
				} catch (ex) {
				}
				if (!url) {
					return;
				}
				let bgLoad = Services.prefs.getBoolPref("browser.tabs.loadInBackground");
				if (event.shiftKey) {
					bgLoad = !bgLoad;
				}
				// We're adding a new tab.
				let newTab = g.loadOneTab(url, {inBackground: bgLoad, allowThirdPartyFixup: true});
				g.pinTab(newTab);
				tt.movePinnedToPlus(newTab, newIndex, orientation);
			}
			g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned);
			delete aDOMWindow.tt.dropEvent;
			dropIndicator.collapsed = true;
		}, false);

		aDOMWindow.tt.toRestore.g.removeTab = g.removeTab;
		g.removeTab =  new Proxy(g.removeTab, { // for FLST after closing tab AND for nullifying 'browser.tabs.animate' about:config pref
			apply: function(target, thisArg, argumentsList) {
				let tab = argumentsList[0];
				if (g.mCurrentTab === tab) {
					switch (Services.prefs.getIntPref("extensions.tabtree.after-close")) {
						case 1: // flst
							let recentlyUsedTabs = Array.filter(g.tabs, (tab) => !tab.closing).sort((tab1, tab2) => tab2.lastAccessed - tab1.lastAccessed);
							g.selectedTab = recentlyUsedTabs[0] === g.mCurrentTab ? recentlyUsedTabs[1] : recentlyUsedTabs[0];
							break;
						case 2: // the closest tab
							let pos = g.mCurrentTab._tPos;
							if (pos + 1 < g.tabs.length && tt.levelInt(g.mCurrentTab) <= tt.levelInt(pos + 1)) {
								g.selectedTab = g.tabs[pos + 1];
							} else if (pos > 0) {
								g.selectedTab = g.tabs[pos - 1];
							}
							break;
						case 3: // previous tab
							if(tab.previousSibling) {
								g.mTabContainer.selectedIndex--;
							}
							break;
					}
				}
				if (argumentsList[1] && argumentsList[1].animate) { // nullifying 'browser.tabs.animate' about:config pref
					// after disabling animation tabs are closed really faster, It can be seen with the naked eye
					// gBrowser.removeTab() uses setTimeout(..., 3000, aTab, this) for animation if you don't believe me
					argumentsList[1].animate = false;
				}
				return target.apply(thisArg, argumentsList);
			}
		}); // don't forget to restore

		aDOMWindow.tt.toRestore.TabContextMenu.updateContextMenu = aDOMWindow.TabContextMenu.updateContextMenu;
		aDOMWindow.TabContextMenu.updateContextMenu = new Proxy(aDOMWindow.TabContextMenu.updateContextMenu, {
			apply: function(target, thisArg, argumentsList) {
				let aPopupMenu = argumentsList[0];
				
				if (aPopupMenu.triggerNode.localName == 'treechildren') {
					let tPos = tree.currentIndex + tt.nPinned;
					aDOMWindow.document.popupNode = g.tabs[tPos]; // Fixes #84 TabTree removes custom entries from tab context menu
					// we use 'Object.defineProperty' because aPopupMenu.triggerNode is not a writable property, plain 'aPopupMenu.triggerNode = blaBlaBla' doesn't work
					// and furthermore it's an inherited getter property:
					Object.defineProperty(aPopupMenu, 'triggerNode', {
						configurable: true,
						enumerable: true,
						writable: false,
						value: g.tabs[tPos]
					});
					target.apply(thisArg, argumentsList); // returns nothing
					delete aPopupMenu.triggerNode; // because it was an inherited property we can delete it to restore default value
				} else if (aPopupMenu.triggerNode.localName == 'ttpinnedtab') {
					let tPos = aPopupMenu.triggerNode.tPos;
					aDOMWindow.document.popupNode = g.tabs[tPos]; // Fixes #84 TabTree removes custom entries from tab context menu
					// we use 'Object.defineProperty' because aPopupMenu.triggerNode is not a writable property, plain 'aPopupMenu.triggerNode = blaBlaBla' doesn't work
					// and furthermore it's an inherited getter property:
					Object.defineProperty(aPopupMenu, 'triggerNode', {
						configurable: true,
						enumerable: true,
						writable: false,
						value: g.tabs[tPos]
					});
					target.apply(thisArg, argumentsList); // returns nothing
					delete aPopupMenu.triggerNode; // because it was an inherited property we can delete it to restore default value
				} else {
					target.apply(thisArg, argumentsList); // returns nothing
				}
			}
		});

		quickSearchBox.addEventListener('input', function(event) {
			if (Services.prefs.getBoolPref('extensions.tabtree.search-jump')) {
				let txt = quickSearchBox.value.toLowerCase();
				if (txt.length >= Services.prefs.getIntPref('extensions.tabtree.search-jump-min-chars')) {
					for (let tPos = g._numPinnedTabs; tPos < g.tabs.length; ++tPos) {
						let url = g.browsers[tPos]._userTypedValue || g.browsers[tPos].contentDocument.URL || '';
						// 'url.toLowerCase()' may be replaced by 'url':
						if (g.tabs[tPos].label.toLowerCase().indexOf(txt) != -1 || url.toLowerCase().indexOf(txt) != -1) {
							g.selectTabAtIndex(tPos);
							quickSearchBox.focus();
							break;
						}
					}
				}
			}
			tree.treeBoxObject.invalidate();
		}, false);

		tree.onkeydown = function(keyboardEvent) {
			if (keyboardEvent.key=='Escape') {
				if (Services.prefs.getBoolPref('extensions.tabtree.search-autohide')) {
					quickSearchBox.collapsed = true;
				} else {
					quickSearchBox.value = '';
					tree.treeBoxObject.invalidate();
				}
			}
		};

		// <Enter> in quick search box = jump to first tab matching quick search
		quickSearchBox.onkeydown = function(keyboardEvent) {
			if (keyboardEvent.key=='Enter') {
				for (let tPos = g._numPinnedTabs; tPos < g.tabs.length; ++tPos) {
					if (tt.quickSearch(quickSearchBox.value, tPos)) {
						g.selectTabAtIndex(tPos);
						quickSearchBox.focus();
						break;
					}
				}
			}
			if (keyboardEvent.key=='Enter' || keyboardEvent.key=='Escape') {
				if (Services.prefs.getBoolPref('extensions.tabtree.search-autohide')) {
					quickSearchBox.collapsed = true;
				} else {
					quickSearchBox.value = '';
					tree.treeBoxObject.invalidate();
				}
			}
		};

		// The next 2 Proxies fix #68 (Cannot move tab with ctrl-shift-pageup/down):
		// Ctrl+Shift+PageUp/Down - normal speed
		// Ctrl+Alt+Shift+PageUp/Down - slow speed
		// Shift+Alt+PageUp/Down - fast speed

		// Ctrl+Shift+PageDown behaviour:
		aDOMWindow.tt.toRestore.g.moveTabForward = g.moveTabForward;
		g.moveTabForward = new Proxy(g.moveTabForward, {
			apply: function(target, thisArg, argumentsList) {
				// based upon tabbrowser.xml#2923:
				let tab = g.mCurrentTab;
				let nextTab = g.tabs[tt.lastDescendantPos(tab)+1];
				if (nextTab) {
					if (tt.levelInt(tab) === tt.levelInt(nextTab)) {
						// moveBranchToPlus also handles moving into a subtree case
						// therefore one more "else" isn't necessary
						tt.moveBranchToPlus(tab, nextTab._tPos, tree.view.DROP_AFTER);
					} else if (tt.levelInt(tab) === tt.levelInt(nextTab) + 1) {
						tt.moveBranchToPlus(tab, nextTab._tPos, tree.view.DROP_BEFORE);
					} else if (tt.levelInt(tab) > tt.levelInt(nextTab) + 1) {
						let grandparent = tt.parentTab(tt.parentTab(tab));
						tt.moveBranchToPlus(tab, grandparent._tPos, tree.view.DROP_ON);
					}
				} else if (g.arrowKeysShouldWrap) {
					g.moveTabToStart();
				}
				tree.treeBoxObject.invalidate();
			}
		}); // don't forget to restore

		// Ctrl+Shift+PageUp behaviour:
		aDOMWindow.tt.toRestore.g.moveTabBackward = g.moveTabBackward;
		g.moveTabBackward = new Proxy(g.moveTabBackward, {
			apply: function(target, thisArg, argumentsList) {
				// based upon tabbrowser.xml#2938:
				let tab = g.mCurrentTab;
				let previousTab = tab.previousSibling;
				while (previousTab && previousTab.hidden) {
					previousTab = previousTab.previousSibling;
				}
				if (previousTab) {
					if (tt.levelInt(tab) === tt.levelInt(previousTab)) {
						tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_BEFORE);
					} else if (tt.levelInt(tab) < tt.levelInt(previousTab)) { // move into a subtree
						let previousTabOnTheSameLevel = previousTab.previousSibling;
						while (previousTabOnTheSameLevel && tt.levelInt(tab) < tt.levelInt(previousTabOnTheSameLevel)) {
							previousTabOnTheSameLevel = previousTabOnTheSameLevel.previousSibling;
						}
						tt.moveBranchToPlus(tab, previousTabOnTheSameLevel._tPos, tree.view.DROP_ON);
					} else if (tt.levelInt(tab) > tt.levelInt(previousTab)) { // move out of a subtree
						tt.moveBranchToPlus(tab, previousTab._tPos, tree.view.DROP_BEFORE);
					}
				} else if (g.arrowKeysShouldWrap) {
					g.moveTabToEnd();
				}
				tree.treeBoxObject.invalidate();
			}
		}); // don't forget to restore

		// I'm just disabling all unnecessary tab movement functions until better times:
		aDOMWindow.tt.toRestore.g.moveTabToStart = g.moveTabToStart;
		g.moveTabToStart = new Proxy(g.moveTabToStart, {
			apply: function(target, thisArg, argumentsList) {
			}
		}); // don't forget to restore
		aDOMWindow.tt.toRestore.g.moveTabToEnd = g.moveTabToEnd;
		g.moveTabToEnd = new Proxy(g.moveTabToEnd, {
			apply: function(target, thisArg, argumentsList) {
			}
		}); // don't forget to restore
		
		// we can't use 'select' event because it fires too many times(when dragging and dropping for example)
		// and therefore it invokes unknown error while selecting pinned tab("TelemetryStopwatch:52:0")
		// instead we use 'click' and 'keyup' events
		// and because of that a tab doesn't load when right clicked:
		
		tree.addEventListener('keyup', function f(event) {
			if (event.key=='ArrowUp' || event.key=='ArrowDown') {
				let tPos = tree.currentIndex + tt.nPinned;
				g.selectTabAtIndex(tPos);
			}
		}, false);

		tree.addEventListener('wheel', function f(event) {
			switch (Services.prefs.getIntPref('extensions.tabtree.wheel')) {
				case 1: // without Shift - changing selected tab, with Shift - ordinary scrolling
					if (event.shiftKey) return;
					break;
				case 2: // always ordinary scrolling
					return;
				case 3: // always changing selected tab
					break;
				default: // == case 0 // without Shift - ordinary scrolling, with Shift - changing selected tab
					if (!event.shiftKey) return;
			}
			
			if (event.deltaY < 0 || event.deltaX < 0) { // wheel up // #64 [OS X] deltaX fixes OS X
				g.tabContainer.advanceSelectedTab(-1, true);
				event.preventDefault();
			} else if (event.deltaY > 0 || event.deltaX > 0) { // wheel down // #64 [OS X] deltaX fixes OS X
				g.tabContainer.advanceSelectedTab(1, true);
				event.preventDefault();
			}
		});

		// Is there a better place in this file for this function?
		let processOverlayClickTree = function(tab) {
			if (tab.hasAttribute('soundplaying')) {
				tab.toggleMuteAudio();
				g.mCurrentTab.pinned
					? tree.view.selection.clearSelection()
					: tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned);
				return true; // tell caller to not select the tab
			}
			return false; // tell caller to process it as if it were a normal click
		};
		
		let onClickFast = function(event) {
			if (event.button === 0) { // the left button click
				let row = {};
				let col = {};
				tree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, {});
				if  (row.value === -1) { // click the empty area
					if (event.detail === 2) { // double click
						aDOMWindow.openUILinkIn(aDOMWindow.BROWSER_NEW_TAB_URL, event.shiftKey ? "window" : "tab");
					}
				} else { // click a row
					let tPos = row.value + tt.nPinned;
					let tab = g.tabs[tPos];
					switch (col.value.index) {
						case TT_COL_CLOSE:
							g.removeTab(tab);
							return;
						case TT_COL_OVERLAY:
							if (processOverlayClickTree(tab)) return;
							// Intentional fall-through otherwise
						default:
							if (tab === g.mCurrentTab) {
								// Tab flip
								if (Services.prefs.getBoolPref("extensions.tabtree.tab-flip")) {
									let recentlyUsedTabs = Array.filter(g.tabs, (tab) => !tab.closing).sort((tab1, tab2) => tab2.lastAccessed - tab1.lastAccessed);
									g.selectedTab = recentlyUsedTabs[0] === g.mCurrentTab ? recentlyUsedTabs[1] : recentlyUsedTabs[0];
								}
							} else {
								g.selectTabAtIndex(tPos);
							}
							return;
					}
				}
			}
		};
		let onClickSlow = function f(event) { // and also double click
			if (event.button === 0) { // the left button click
				let row = {};
				let col = {};
				tree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, {});
				if  (row.value === -1) { // click the empty area
					if (event.detail === 2) { // double click
						aDOMWindow.openUILinkIn(aDOMWindow.BROWSER_NEW_TAB_URL, event.shiftKey ? "window" : "tab");
					}
				} else { // click a row
					let tPos = row.value + tt.nPinned;
					let tab = g.tabs[tPos];
					if (event.detail == 1) { // the first click - select a tab
						switch (col.value.index) {
							case TT_COL_CLOSE:
								g.removeTab(tab);
								return;
							case TT_COL_OVERLAY:
								if (processOverlayClickTree(tab)) return;
								// Intentional fall-through otherwise
							default:
								f.timer = aDOMWindow.setTimeout(function () {
									if (tab === g.mCurrentTab) {
										// Tab flip
										if (Services.prefs.getBoolPref("extensions.tabtree.tab-flip")) {
											let recentlyUsedTabs = Array.filter(g.tabs, (tab) => !tab.closing).sort((tab1, tab2) => tab2.lastAccessed - tab1.lastAccessed);
											g.selectedTab = recentlyUsedTabs[0] === g.mCurrentTab ? recentlyUsedTabs[1] : recentlyUsedTabs[0];
										}
									} else {
										g.selectTabAtIndex(tPos);
									}
								}, Services.prefs.getIntPref('extensions.tabtree.delay'));
								return;
						}
					} else if (event.detail == 2) { // the second click - remove a tab
						aDOMWindow.clearTimeout(f.timer);
						handleDblClick(tab);
					}
				}
			}
		};
		
		let handleDblClick = function f(tab) {
			let pref = Services.prefs.getIntPref('extensions.tabtree.dblclick');
			if (pref === 1) {
				g.removeTab(tab);
			} else if (pref === 2) {
				if (tab.pinned || ss.getTabValue(tab, 'ttLevel') === '') {
					g.unpinTab(tab);
				} else {
					g.pinTab(tab);
				}
			}
		};
		
		if (Services.prefs.getIntPref('extensions.tabtree.dblclick') === 0) {
			tree.addEventListener('click', onClickFast, false);
		} else {
			tree.addEventListener('click', onClickSlow, false);
			
			toolbar.addEventListener('dblclick', function f(event) {
				event.preventDefault();
				event.stopPropagation();
				
				handleDblClick(g.tabs[tt.nPinned - 1]);
			}, false);
		}
		
		newTab.addEventListener('command', function(event) {
			aDOMWindow.openUILinkIn(aDOMWindow.BROWSER_NEW_TAB_URL, event.shiftKey ? "window" : "tab");
		}, false);
		
		newTab.addEventListener("mouseup", function (event) {
			if(event.button === 1){
				let tab = g.mCurrentTab;
				let tPos = tab._tPos;
				let lvl = ss.getTabValue(tab, "ttLevel");
				let newTab = g.addTab("about:newtab"); // our new tab will be opened at position g.tabs.length - 1
				for (let i = tPos + 1; i < g.tabs.length - 1; ++i) {
					if (parseInt(ss.getTabValue(g.tabs[i], "ttLevel")) <= parseInt(lvl)) {
						g.moveTabTo(newTab, i);
						break;
					}
				}
				ss.setTabValue(newTab, "ttLevel", lvl);
				g.selectedTab = newTab;
			}
		}, false);
        
		g.tabContainer.addEventListener("TabMove", (aDOMWindow.tt.toRemove.eventListeners.onTabMove = function(event) {
			let tab = event.target;
			tab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(tab._tPos - tt.nPinned);
			tt.redrawToolbarbuttons();
		}), false); // don't forget to remove
		

		// "This event should be dispatched when any of these attributes change:
		// label, crop, busy, image, selected" from 'tabbrowser.xml'
		// but of course it doesn't. It is not dispatched when refreshing a page, although a 'busy' attribute changes
		// actually it fires only once when a 'busy' attribute is removed, but not when it is set
		g.tabContainer.addEventListener("TabAttrModified", (aDOMWindow.tt.toRemove.eventListeners.onTabAttrModified = function(event) {
			let tab = event.target;
			if (!('ttThrob' in tab)) {
				if (tab.hasAttribute('busy')) {
					// we must do it with unpinned and pinned tabs
					// because a pinned tab can become an unpinned tab while loading or connecting
					tab.ttThrobC = 1;
					tab.ttThrob = aDOMWindow.setInterval(function() {
						let mainTree = aDOMWindow.document.querySelector('#tt');
						// if there is no <tree id="tt"> then it must mean that add-on has been shut down while a tab was 'loading' or 'connecting'
						// we must clear our 'interval' in that case
						if (mainTree && tab.hasAttribute('busy') && !tab.closing) {
							if (!tab.pinned) {
								tab.ttThrobC = tab.ttThrobC === 18 ? 1 : tab.ttThrobC + 1;
								mainTree.treeBoxObject.invalidateRow(tab._tPos - tt.nPinned);
							} // else saving CPU cycles
						} else {
							// we can also clear this Interval in 'getImageSrc'
							aDOMWindow.clearInterval(tab.ttThrob);
							delete tab.ttThrobC;
							delete tab.ttThrob;
						}
					}, 50); // originally it was 50ms for 'connecting.png' and 40ms for 'loading.png'
				}
			}

			// Hiding TT_COL_OVERLAY column when there's no at least 1 audio indicator and vice versa
			// Duplicate this code in onTabAttrModified, pinTab and unpinTab
			treecol.overlay.collapsed = !Array.some(g.tabs, (x) => !x.pinned && (x.hasAttribute('muted') || x.hasAttribute('soundplaying')));

			tab.pinned ? tt.redrawToolbarbuttons() : tree.treeBoxObject.invalidateRow(tab._tPos - tt.nPinned);
		}), false); // don't forget to remove

		// but it can be easily corrected:
		//noinspection JSUnusedGlobalSymbols
		g.addTabsProgressListener((aDOMWindow.tt.toRemove.tabsProgressListener = {
			onStateChange: function(/*nsIDOMXULElement*/ aBrowser, /*nsIWebProgress*/ aWebProgress, /*nsIRequest*/ aRequest, /*unsigned long*/ aStateFlags, /*nsresult*/ aStatus) {
				// "If you use myListener for more than one tab/window, use
				// aWebProgress.DOMWindow to obtain the tab/window which triggers the state change" from MDN
				g._tabAttrModified(g.getTabForBrowser(aBrowser));
			},
			
			// it is necessary to detect when 'progress' attribute appears (it is necessary to properly animate a 'progress' state on pinned tabs):
			onProgressChange: function(/*nsIDOMXULElement*/ aBrowser, /*nsIWebProgress*/ aWebProgress, /*nsIRequest*/ aRequest, /*PRInt32*/
									   aCurSelfProgress, /*PRInt32*/ aMaxSelfProgress, /*PRInt32*/ aCurTotalProgress, /*PRInt32*/ aMaxTotalProgress) {
				g._tabAttrModified(g.getTabForBrowser(aBrowser));
			}
		})); // don't forget to remove
		
		g.tabContainer.addEventListener("TabSelect", (aDOMWindow.tt.toRemove.eventListeners.onTabSelect = function(event) {
			if (g.tabContainer.ttUndoingCloseTab) {
				// if a tab is selected as part of a process of restoring a closed tab then do nothing
				delete g.tabContainer.ttUndoingCloseTab;
			} else {
				let tab = event.target;
				tab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(tab._tPos - tt.nPinned);
				tt.redrawToolbarbuttons();
				if (!tab.pinned) {
					tree.treeBoxObject.ensureRowIsVisible(tab._tPos - tt.nPinned);
				}
			}
		}), false); // don't forget to remove
		
		// Middle click to close a tab
		tree.addEventListener('click', function onMiddleClick(event) {
			if (event.button === 1) { // middle click
				let idx = tree.treeBoxObject.getRowAt(event.clientX, event.clientY);
				if (idx === -1) { // on empty space (i.e. the tabbar)
					switch (Services.prefs.getIntPref("extensions.tabtree.middle-click-tabbar")) {
						case 1: // reopen last closed tab
							aDOMWindow.undoCloseTab();
							break;
						default: // open a new tab (or a window)
							aDOMWindow.openUILinkIn(aDOMWindow.BROWSER_NEW_TAB_URL, event.shiftKey ? "window" : "tab");
					}
				} else { // on a tab
					let tPos = idx + tt.nPinned;
					g.removeTab(g.tabs[tPos]);
				}
			}
		}, false);

		treetooltip.addEventListener('popupshowing', function onTreeTooltipShowing(event) {
			let row = {};
			let col = {};
			tree.treeBoxObject.getCellAt(event.clientX, event.clientY, row, col, {});
			if(row.value == -1) {
				treetooltip.setAttribute('label', stringBundle.GetStringFromName('dbl_click_new_tab'));
				return;
			}

			let tPos = row.value + tt.nPinned;
			let tab = g.tabs[tPos];
			let bundle = g.mStringBundle;
			// The string creation bit was taken from createTooltip() in chrome://browser/content/tabbrowser.xml
			//noinspection FallThroughInSwitchStatementJS
			switch (col.value.index) {
				case TT_COL_CLOSE:
					treetooltip.setAttribute("label", bundle.getString("tabs.closeTab.tooltip"));
					break;
				case TT_COL_OVERLAY:
					if (tab.hasAttribute('muted') || tab.hasAttribute('soundplaying')) {
						let stringID = tab.linkedBrowser.audioMuted ?
							"tabs.unmuteAudio.tooltip" :
							"tabs.muteAudio.tooltip";
						let key = aDOMWindow.document.getElementById("key_toggleMute");
						let shortcut = ShortcutUtils.prettifyShortcut(key);
						let label = bundle.getFormattedString(stringID, [shortcut]);
						treetooltip.setAttribute("label", label);
						break;
					}
					// Intentional fallthrough otherwise, after
					// pretending we were over the tab's label all along
					col.value = col.value.columns.getColumnAt(TT_COL_TITLE);
				default:
					if (tree.treeBoxObject.isCellCropped(row.value, col.value)) {
						treetooltip.setAttribute("label", tab.label);
					} else {
						event.preventDefault();
					}
					break;
			}
		}, false);

		//////////////////// TAB CONTEXT MENU //////////////////////////////////////////////////////////////////////////
		// Labels are set in prefs observer "extensions.tabtree.prefix-context-menu-items"

		let menuItemCloseTree = aDOMWindow.document.createElement('menuitem'); // removed in unloadFromWindow()
		menuItemCloseTree.id = 'tt-context-close-tree';
		//menuItemCloseTree.setAttribute('label', stringBundle.GetStringFromName('close_this_tree'));
		menuItemCloseTree.addEventListener('command', function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let tPos = tab._tPos;
			let lvl = ss.getTabValue(tab, 'ttLevel');
			while (ss.getTabValue(g.tabs[tPos+1], 'ttLevel') > lvl) {
				g.removeTab(g.tabs[tPos+1]);
			}
			g.removeTab(g.tabs[tPos]);
		}, false);

		let menuItemCloseChildren = aDOMWindow.document.createElement('menuitem'); // removed in unloadFromWindow()
		menuItemCloseChildren.id = 'tt-context-close-children';
		//menuItemCloseChildren.setAttribute('label', stringBundle.GetStringFromName('close_children'));
		menuItemCloseChildren.addEventListener('command', function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let tPos = tab._tPos;
			let lvl = ss.getTabValue(tab, 'ttLevel');
			while (ss.getTabValue(g.tabs[tPos+1], 'ttLevel') > lvl) {
				g.removeTab(g.tabs[tPos+1]);
			}
		}, false);

		let menuItemReloadTree = aDOMWindow.document.createElement('menuitem'); // removed in unloadFromWindow()
		menuItemReloadTree.id = 'tt-context-reload-tree';
		//menuItemReloadTree.setAttribute('label', stringBundle.GetStringFromName('reload_this_tree'));
		menuItemReloadTree.addEventListener('command', function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let tPos = tab._tPos;
			let lvl = ss.getTabValue(tab, 'ttLevel');
			let childIdx = 1;
			while (ss.getTabValue(g.tabs[tPos+childIdx], 'ttLevel') > lvl) {
				g.reloadTab(g.tabs[tPos+childIdx]);
				++childIdx;
			}
			g.reloadTab(g.tabs[tPos]);
		}, false);

		let menuItemOpenNewTabSibling = aDOMWindow.document.createElement("menuitem"); // removed in unloadFromWindow()
		menuItemOpenNewTabSibling.id = "tt-content-open-sibling";
		//menuItemOpenNewTabSibling.setAttribute("label", stringBundle.GetStringFromName("open_sibling"));
		menuItemOpenNewTabSibling.addEventListener("command", function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let tPos = tab._tPos;
			let lvl = ss.getTabValue(tab, "ttLevel");
			let newTab = g.addTab("about:newtab"); // our new tab will be opened at position g.tabs.length - 1
			for (let i = tPos + 1; i < g.tabs.length - 1; ++i) {
				if (parseInt(ss.getTabValue(g.tabs[i], "ttLevel")) <= parseInt(lvl)) {
					g.moveTabTo(newTab, i);
					break;
				}
			}
			ss.setTabValue(newTab, "ttLevel", lvl);
			g.selectedTab = newTab;
		}, false);

		let menuItemOpenNewTabChild = aDOMWindow.document.createElement("menuitem"); // removed in unloadFromWindow()
		menuItemOpenNewTabChild.id = "tt-content-open-child";
		//menuItemOpenNewTabChild.setAttribute("label", stringBundle.GetStringFromName("open_child"));
		menuItemOpenNewTabChild.addEventListener("command", function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let lvl = ss.getTabValue(tab, "ttLevel");
			let newTab = g.addTab("about:newtab"); // our new tab will be opened at position g.tabs.length - 1
			if (Services.prefs.getBoolPref("extensions.tabtree.insertRelatedAfterCurrent")) {
				g.moveTabTo(newTab, tab._tPos + 1);
			} else {
				g.moveTabTo(newTab, tt.lastDescendantPos(tab) + 1);
			}
			ss.setTabValue(newTab, "ttLevel", (parseInt(lvl) + 1).toString());
			g.selectedTab = newTab;
		}, false);
		
		let menuItemDuplicateTabAsSibling = aDOMWindow.document.createElement("menuitem"); // removed in unloadFromWindow()
		menuItemDuplicateTabAsSibling.id = "tt-content-duplicate-Sibling";
		//menuItemDuplicateTabAsSibling.setAttribute("label", stringBundle.GetStringFromName("duplicate_sibling"));
		menuItemDuplicateTabAsSibling.addEventListener("command", function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let tPos = tab._tPos;
			let lvl = ss.getTabValue(tab, "ttLevel");
			for (let i = tPos + 1; i < g.tabs.length - 1; ++i) {
				if (parseInt(ss.getTabValue(g.tabs[i], "ttLevel")) <= parseInt(lvl)) {
					tt.duplicateTab(tab, lvl, i);
					break;
				}
			}
		}, false);
		
		let menuItemDuplicateTabAsChild = aDOMWindow.document.createElement("menuitem"); // removed in unloadFromWindow()
		menuItemDuplicateTabAsChild.id = "tt-content-open-child";
		//menuItemDuplicateTabAsChild.setAttribute("label", stringBundle.GetStringFromName("duplicate_child"));
		menuItemDuplicateTabAsChild.addEventListener("command", function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			let lvl = ss.getTabValue(tab, "ttLevel");
			if (Services.prefs.getBoolPref("extensions.tabtree.insertRelatedAfterCurrent")) {
				tt.duplicateTab(tab, parseInt(lvl) + 1, tab._tPos + 1);
			} else {
				tt.duplicateTab(tab, parseInt(lvl) + 1, tt.lastDescendantPos(tab) + 1);
			}
		}, false);
		
		let menuItemDuplicateTabToBottom = aDOMWindow.document.createElement("menuitem"); // removed in unloadFromWindow()
		menuItemDuplicateTabToBottom.id = "tt-content-open-child";
		//menuItemDuplicateTabToBottom.setAttribute("label", stringBundle.GetStringFromName("duplicate_bottom"));
		menuItemDuplicateTabToBottom.addEventListener("command", function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;
			tt.duplicateTab(tab, 0);
		}, false);

		let tabContextMenu = aDOMWindow.document.querySelector('#tabContextMenu');
		let tabContextMenuCloseTab = aDOMWindow.document.querySelector('#context_closeTab');
		tabContextMenu.insertBefore(menuItemDuplicateTabToBottom, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemDuplicateTabAsChild, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemDuplicateTabAsSibling, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemOpenNewTabChild, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemOpenNewTabSibling, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemReloadTree, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemCloseChildren, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.insertBefore(menuItemCloseTree, tabContextMenuCloseTab.nextSibling);
		tabContextMenu.addEventListener('popupshowing', (aDOMWindow.tt.toRemove.eventListeners.onPopupshowing = function (event) {
			let tab = aDOMWindow.TabContextMenu.contextTab;

			menuItemReloadTree.hidden = menuItemCloseTree.hidden = menuItemCloseChildren.hidden = !tt.hasAnyChildren(tab._tPos);
			menuItemOpenNewTabChild.hidden = tab.pinned;
			menuItemOpenNewTabSibling.hidden = tab._tPos < tt.nPinned - 1;
			
			menuItemDuplicateTabAsChild.hidden = tab.pinned;
			
			g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - g._numPinnedTabs);
		}), false); // removed in unloadFromWindow()
		//////////////////// END TAB CONTEXT MENU //////////////////////////////////////////////////////////////////////

		//noinspection JSUnusedGlobalSymbols
		Services.prefs.addObserver('', (aDOMWindow.tt.toRemove.prefsObserver = {
			observe: function(subject, topic, data) {
				if (topic == 'nsPref:changed') {
					switch (data) {
						case "extensions.tabtree.auto-hide-when-fullscreen":
							if (Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-fullscreen")) {
								aDOMWindow.document.documentElement.setAttribute("tt-auto-hide-when-fullscreen", "true");
							} else {
								aDOMWindow.document.documentElement.removeAttribute("tt-auto-hide-when-fullscreen");
								sidebar.style.visibility = "";
								sidebar.style.position = "";
								splitter.style.visibility = "";
								splitter.style.position = "";
								hoverArea.style.visibility = "";
								hoverArea.style.marginLeft = "";
								hoverArea.style.marginRight = "";
							}
						break;
						case "extensions.tabtree.auto-hide-when-maximized":
							if (Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-maximized")) {
								aDOMWindow.document.documentElement.setAttribute("tt-auto-hide-when-maximized", "true");
							} else {
								aDOMWindow.document.documentElement.removeAttribute("tt-auto-hide-when-maximized");
								sidebar.style.visibility = "";
								sidebar.style.position = "";
								splitter.style.visibility = "";
								splitter.style.position = "";
								hoverArea.style.visibility = "";
								hoverArea.style.marginLeft = "";
								hoverArea.style.marginRight = "";
							}
						break;
						case "extensions.tabtree.auto-hide-when-normal":
							if (Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-normal")) {
								aDOMWindow.document.documentElement.setAttribute("tt-auto-hide-when-normal", "true");
							} else {
								aDOMWindow.document.documentElement.removeAttribute("tt-auto-hide-when-normal");
								sidebar.style.visibility = "";
								sidebar.style.position = "";
								splitter.style.visibility = "";
								splitter.style.position = "";
								hoverArea.style.visibility = "";
								hoverArea.style.marginLeft = "";
								hoverArea.style.marginRight = "";
							}
						break;
						case "extensions.tabtree.auto-hide-when-only-one-tab":
							if (Services.prefs.getBoolPref("extensions.tabtree.auto-hide-when-only-one-tab")) {
								aDOMWindow.document.documentElement.setAttribute("tt-auto-hide-when-only-one-tab", "true");
							} else {
								aDOMWindow.document.documentElement.removeAttribute("tt-auto-hide-when-only-one-tab");
								sidebar.style.visibility = "";
								sidebar.style.position = "";
								splitter.style.visibility = "";
								splitter.style.position = "";
								hoverArea.style.visibility = "";
								hoverArea.style.marginLeft = "";
								hoverArea.style.marginRight = "";
							}
						break;
						case 'browser.tabs.drawInTitlebar':
							if (Services.appinfo.OS == 'WINNT') {
								if (Services.prefs.getBoolPref('browser.tabs.drawInTitlebar') && aDOMWindow.windowState == aDOMWindow.STATE_MAXIMIZED
									&& menu.getAttribute('autohide') == 'true' && menu.hasAttribute('inactive')) {
									// BEGIN Beyond Australis compatibility:
									// window controls wouldn't be visible because the buttonbox container wouldn't be in the right place
									if(navToolbox.getAttribute('slimChromeNavBar') == 'true') {
										let slimmer = aDOMWindow.document.querySelector('#theFoxOnlyBetter-slimChrome-slimmer');
										slimmer.appendChild(slimSpacer);
										slimmer.appendChild(titlebarButtonsClone);
									} else {
										navBar.appendChild(titlebarButtonsClone);
										if(slimSpacer.parentNode !== null) {
											slimSpacer.parentNode.removeChild(slimSpacer);
										}
										
									}
									// END Beyond Australis compatibility
									
									titlebarButtons.style.marginRight = '-9999px'; // Beyond Australis compatibility
								} else {
									if (titlebarButtonsClone.parentNode !== null) { // if it exists
										titlebarButtonsClone.parentNode.removeChild(titlebarButtonsClone);
										if(slimSpacer.parentNode !== null) {
											slimSpacer.parentNode.removeChild(slimSpacer);
										}
									}
									titlebarButtons.style.marginRight = ''; // Beyond Australis compatibility
								}
							} // else do nothing
							break;
						case 'extensions.tabtree.close-tab-buttons':
							treecol.closebtn.collapsed = !Services.prefs.getBoolPref('extensions.tabtree.close-tab-buttons');
							break;
						case 'extensions.tabtree.dblclick':
							if (Services.prefs.getIntPref('extensions.tabtree.dblclick')) {
								tree.removeEventListener('click', onClickFast, false);
								tree.addEventListener('click', onClickSlow, false);
							} else {
								tree.removeEventListener('click', onClickSlow, false);
								tree.addEventListener('click', onClickFast, false);
							}
							break;
						case 'extensions.tabtree.highlight-unloaded-tabs':
							prefPending = Services.prefs.getIntPref('extensions.tabtree.highlight-unloaded-tabs');
							tree.treeBoxObject.invalidate();
							break;
						case 'extensions.tabtree.highlight-unread-tabs':
							prefUnread = Services.prefs.getBoolPref('extensions.tabtree.highlight-unread-tabs');
							tree.treeBoxObject.invalidate();
							break;
						case 'extensions.tabtree.position':
							let firstVisibleRow = tree.treeBoxObject.getFirstVisibleRow();
							setTTPos(Services.prefs.getIntPref('extensions.tabtree.position'));
							tree.view = view;
							tree.treeBoxObject.scrollToRow(firstVisibleRow);
							tt.redrawToolbarbuttons();
							tt.forceReflow(); // fixes bug #12
							break;
						case 'extensions.tabtree.prefix-context-menu-items': // #36 ([Feature] Middle click on empty space to open a new tab)
							let prefix = Services.prefs.getBoolPref("extensions.tabtree.prefix-context-menu-items") ? "Tab Tree: " : "";
							menuItemCloseTree.setAttribute("label", prefix + stringBundle.GetStringFromName("close_this_tree"));
							menuItemCloseChildren.setAttribute("label", prefix + stringBundle.GetStringFromName("close_children"));
							menuItemReloadTree.setAttribute("label", prefix + stringBundle.GetStringFromName("reload_this_tree"));
							menuItemOpenNewTabSibling.setAttribute("label", prefix + stringBundle.GetStringFromName("open_sibling"));
							menuItemOpenNewTabChild.setAttribute("label", prefix + stringBundle.GetStringFromName("open_child"));
							menuItemDuplicateTabAsSibling.setAttribute("label", prefix + stringBundle.GetStringFromName("duplicate_sibling"));
							menuItemDuplicateTabAsChild.setAttribute("label", prefix + stringBundle.GetStringFromName("duplicate_child"));
							menuItemDuplicateTabToBottom.setAttribute("label", prefix + stringBundle.GetStringFromName("duplicate_bottom"));
							break;
						case 'extensions.tabtree.new-tab-button':
							newTab.collapsed = !Services.prefs.getBoolPref('extensions.tabtree.new-tab-button');
							break;
						case 'extensions.tabtree.search-autohide':
							let prefAutohide = Services.prefs.getBoolPref('extensions.tabtree.search-autohide');
							quickSearchBox.collapsed = prefAutohide;
							if (prefAutohide) {
								appcontent.addEventListener('mouseup', aDOMWindow.tt.toRemove.eventListeners.onAppcontentMouseUp, false); // don't forget to remove
							} else {
								appcontent.removeEventListener('mouseup', aDOMWindow.tt.toRemove.eventListeners.onAppcontentMouseUp, false);
							}
							break;
						case 'extensions.tabtree.search-position':
							switch (Services.prefs.getIntPref('extensions.tabtree.search-position')) {
								case 1:
									sidebar.insertBefore(quickSearchBox, newTabContainer); // before "New tab" button
									break;
								case 2:
									sidebar.appendChild(quickSearchBox); // after "New tab" button
									break;
								default:
									sidebar.insertBefore(quickSearchBox, sidebar.firstChild); // at the top
							}
							break;
						case "extensions.tabtree.tab-height":
							// I could've implemented this pref handler in startup() because CSS needs to be loaded only once
							// but in order to use aDOMWindow.Blob and aDOMWindow.URL a reference to aDOMWindow is required
							// and it's quite problematic to get reference to any aDOMWindow at startup()
							// and also the tab tree in every FF window must be "redrawn" after applying CSS:
							let tabHeight = Services.prefs.getIntPref("extensions.tabtree.tab-height");
							if (tabHeightGlobal.value !== tabHeight) {
								tabHeightGlobal.value = tabHeight;
								if (tabHeightGlobal.uri && sss.sheetRegistered(tabHeightGlobal.uri, sss.AUTHOR_SHEET)) {
									sss.unregisterSheet(tabHeightGlobal.uri, sss.AUTHOR_SHEET);
								}
								if (tabHeightGlobal.value > 0) {
									let blob = new aDOMWindow.Blob([`#tt-treechildren::-moz-tree-row,#tt-treechildren-feedback::-moz-tree-row{min-height:1px;height:${tabHeight}px;}`]);
									let url = aDOMWindow.URL.createObjectURL(blob);
									tabHeightGlobal.uri = Services.io.newURI(url, null, null);
									sss.loadAndRegisterSheet(tabHeightGlobal.uri, sss.AUTHOR_SHEET);
								}
							}
							let redrawHack = tree.style.borderStyle; // hack to force to redraw <tree>
							tree.style.borderStyle = 'none';
							tree.style.borderStyle = redrawHack;
							tree.treeBoxObject.invalidate();
							break;
						case "extensions.tabtree.tab-numbers":
							tabNumbers = Services.prefs.getBoolPref("extensions.tabtree.tab-numbers");
							tree.treeBoxObject.invalidate();
						break;
						case 'extensions.tabtree.treelines':
							tree.setAttribute('treelines', Services.prefs.getBoolPref('extensions.tabtree.treelines').toString());
							dragFeedbackTree.setAttribute('treelines', Services.prefs.getBoolPref('extensions.tabtree.treelines').toString());
							let hack = tree.style.borderStyle; // hack to force to redraw 'treelines'
							tree.style.borderStyle = 'none';
							tree.style.borderStyle = hack;
							tree.treeBoxObject.invalidate();
							break;
					}
				}
			}
		}), false); // don't forget to remove // it can be removed in 'onCloseWindow' or in 'unloadFromWindow'(upon addon shutdown)
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, "nsPref:changed", "extensions.tabtree.auto-hide-when-fullscreen");
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, "nsPref:changed", "extensions.tabtree.auto-hide-when-maximized");
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, "nsPref:changed", "extensions.tabtree.auto-hide-when-normal");
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, "nsPref:changed", "extensions.tabtree.auto-hide-when-only-one-tab");
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, 'nsPref:changed', 'extensions.tabtree.prefix-context-menu-items');
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, "nsPref:changed", "extensions.tabtree.tab-height");
		aDOMWindow.tt.toRemove.prefsObserver.observe(null, "nsPref:changed", "extensions.tabtree.tab-numbers");

		tt.redrawToolbarbuttons(); // needed when addon is enabled from about:addons (not when firefox is being loaded)
		tree.treeBoxObject.invalidate(); // just in case
		// highlighting a current tree row/toolbarbutton at startup:
		g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned);
		// scroll <tree id="tt"> to the position where it was before shutdown/restart:
		tree.treeBoxObject.scrollToRow(parseInt(ss.getWindowValue(aDOMWindow, 'tt-first-visible-row')));
		// but ensuring that a selected row is visible takes priority over the scrolling position:
		if (!g.mCurrentTab.pinned) {
			tree.treeBoxObject.ensureRowIsVisible(g.mCurrentTab._tPos - tt.nPinned);
		}
		tt.redrawToolbarbuttons();
		//aDOMWindow.TabsInTitlebar._update(true); // already called by Firefox
		tt.forceReflow(); // fixes bug #12
		
		// the problem is that at Firefox startup at this point tab.hasAttribute('image') is always 'false'
		aDOMWindow.tt.toRestore.g.setIcon = g.setIcon;
		g.setIcon = new Proxy(g.setIcon, {
			apply: function(target, thisArg, argumentsList) {
				target.apply(thisArg, argumentsList); // returns nothing
				let tab = argumentsList[0];
				if (tab.hasAttribute('image')) {
					let im = new aDOMWindow.Image(); // I don't know any other way to check whether the image was loaded or not
					im.src = tab.image;
					if (!im.complete) { // if the image wasn't yet loaded then listen for 'load' event
						let xulImage = aDOMWindow.document.getAnonymousElementByAttribute(tab, 'anonid', 'tab-icon-image');
						xulImage.addEventListener('load', function onLoad(event) { // refresh a row image when the favicon is loaded at add-on startup
							xulImage.removeEventListener('load', onLoad, false);
							let mainTree = aDOMWindow.document.querySelector('#tt');
							if (mainTree) { // checking if our add-on hasn't been shut down while we were waiting for the 'load' event to fire
								//let tab = aDOMWindow.document.getBindingParent(event.target); // already here
								if (!tab.pinned) { // status of a tab can potentially be changed while waiting for the 'load' event to fire
									mainTree.treeBoxObject.invalidateRow(tab._tPos - tt.nPinned);
								}
							}
						}, false);
					}
				}
			}
		}); // don't forget to restore

		aDOMWindow.tt.toRestore.g.replaceTabWithWindow = g.replaceTabWithWindow;
		g.replaceTabWithWindow =  new Proxy(g.replaceTabWithWindow, { // "Move to New Window" tab context menu command, by default it keeps 'ttLevel'
			apply: function(target, thisArg, argumentsList) {
				let tab = argumentsList[0];
				ss.setTabValue(tab, 'ttLevel', '0');
				ss.deleteTabValue(tab, 'ttSS'); // just in case, nothing happens if there is no 'ttSS'
				return target.apply(thisArg, argumentsList);
			}
		}); // don't forget to restore

		ss.setGlobalValue('tt-new-sidebar-width', sidebar.width);
		(aDOMWindow.tt.toRemove.sidebarWidthObserver = new aDOMWindow.MutationObserver(function(aMutations) {
			for (let mutation of aMutations) {
				if (mutation.attributeName == 'width') {
					ss.setWindowValue(aDOMWindow, 'tt-width', sidebar.width); // Remember the width of 'tt-sidebar'
					ss.setGlobalValue('tt-new-sidebar-width', sidebar.width);
					
					// Resize Tab Tree's sidebar in auto-hide mode while hovering over:
					let w = aDOMWindow.document.documentElement;
					if (
						w.getAttribute("sizemode") === "fullscreen" && w.hasAttribute("tt-auto-hide-when-fullscreen") ||
						w.getAttribute("sizemode") === "maximized" && w.hasAttribute("tt-auto-hide-when-maximized") ||
						w.getAttribute("sizemode") === "normal" && w.hasAttribute("tt-auto-hide-when-normal") ||
						w.hasAttribute("tt-only-one-tab") && w.hasAttribute("tt-auto-hide-when-only-one-tab")
					) {
						let splitterWidth = parseFloat(aDOMWindow.getComputedStyle(splitter).marginLeft) + parseFloat(aDOMWindow.getComputedStyle(splitter).marginRight) + splitter.getBoundingClientRect().width;
						let margin = `-${sidebar.getBoundingClientRect().width + splitterWidth + hoverArea.getBoundingClientRect().width}px`;
						if (Services.prefs.getIntPref("extensions.tabtree.position") === TT_POS_LEFT) {
							hoverArea.style.marginLeft = "";
							hoverArea.style.marginRight = margin;
						} else if (Services.prefs.getIntPref("extensions.tabtree.position") === TT_POS_RIGHT) {
							hoverArea.style.marginLeft = margin;
							hoverArea.style.marginRight = "";
						}
					}
					
					return;
				}
				if (mutation.attributeName == 'height') {
					ss.setWindowValue(aDOMWindow, 'tt-height', sidebar.height); // Remember the height of 'tt-sidebar'
					ss.setGlobalValue('tt-new-sidebar-height', sidebar.height);
					return;
				}
			}
		})).observe(sidebar, {attributes: true}); // removed in unloadFromWindow()

		(aDOMWindow.tt.toRemove.numberOfTabsObserver = new aDOMWindow.MutationObserver(function(aMutations) {
			// if there's only one tab then set attr that helps to hide the tab tree
			if (g.tabs.length <= 1) {
				aDOMWindow.document.documentElement.setAttribute("tt-only-one-tab", "true");
			} else {
				aDOMWindow.document.documentElement.removeAttribute("tt-only-one-tab");
			}
		})).observe(g.tabContainer, {childList: true}); // removed in unloadFromWindow()
		aDOMWindow.tt.toRemove.numberOfTabsObserver.mutationCallback(); // call it once like we always do for initialization purposes

		// OS X tabs not in titlebar fix
		// And tab search box styling:
		Services.obs.addObserver((aDOMWindow.tt.toRemove.themeChangedObserver = {
			observe(subject, topic, data) {
				if (topic === "tt-theme-changed") {
					if (Services.appinfo.OS == "Darwin") { // or AppConstants.platform === "macosx"
						aDOMWindow.document.documentElement.removeAttribute("chromemargin"); // show a native titlebar like in Safari
					}
					if (Services.prefs.getIntPref("extensions.tabtree.theme") === 0 || data === "{972ce4c6-7e08-4474-a285-3208198ce6fd}") {
						quickSearchBox.setAttribute("type", "search");
						quickSearchBox.classList.add("compact");
						// Workaround for Firefox bug when clicking "_clearSearch" button on textbox[type="search"] doesn't rise the "input" event
						// setTimeout is necessary because otherwise "searchClearButton" is null:
						aDOMWindow.setTimeout(() => {
							let searchClearButton = aDOMWindow.document.getAnonymousElementByAttribute(quickSearchBox, "class", "textbox-search-clear");
							searchClearButton.addEventListener("click", () => {
								tree.treeBoxObject.invalidate();
							});
						}, 600);
					} else {
						quickSearchBox.removeAttribute("type");
						quickSearchBox.classList.remove("compact");
						// searchClearButton is destroyed upon removing "type" attribute (and so listener is removed)
					}
				}
			}
		}), "tt-theme-changed", false);
		// "themeChangedObserver" is removed in
		// 1) "onCloseWindow" in case Tab Tree is enabled and one Firefox window is being closed
		// 2) "unloadFromWindow" in case Tab Tree is being disabled

		// Determine ID of the current theme:
		AddonManager.getAddonsByTypes(["theme"], (themes) => {
			for (let theme of themes) {
				if (!theme.userDisabled) {
					aDOMWindow.tt.toRemove.themeChangedObserver.observe(null, "tt-theme-changed", theme.id);
					break;
				}
			}
		});
		
		toggler.addEventListener("mouseenter", function () {
			sidebar.style.visibility = "visible";
			splitter.style.visibility = "visible";
			hoverArea.style.visibility = "visible";
			
			sidebar.style.position = "relative";
			splitter.style.position = "relative";
			
			let splitterWidth = parseInt(aDOMWindow.getComputedStyle(splitter).marginLeft) + parseInt(aDOMWindow.getComputedStyle(splitter).marginRight) + splitter.getBoundingClientRect().width;
			let margin = `-${sidebar.getBoundingClientRect().width + splitterWidth + hoverArea.getBoundingClientRect().width}px`;
			if (Services.prefs.getIntPref("extensions.tabtree.position") === TT_POS_LEFT) {
				hoverArea.style.marginLeft = "";
				hoverArea.style.marginRight = margin;
			} else if (Services.prefs.getIntPref("extensions.tabtree.position") === TT_POS_RIGHT) {
				hoverArea.style.marginLeft = margin;
				hoverArea.style.marginRight = "";
			}
		});
		
		let onMouseOut = function (event) {
			for (let el = event.relatedTarget; el; el = el.parentElement) {
				if (el === toggler || el === sidebar || el === splitter || el === hoverArea) {
					return;
				}
			}
			sidebar.style.visibility = "";
			sidebar.style.position = "";
			splitter.style.visibility = "";
			splitter.style.position = "";
			hoverArea.style.visibility = "";
			hoverArea.style.marginLeft = "";
			hoverArea.style.marginRight = "";
		};
		toggler.addEventListener("mouseout", onMouseOut);
		sidebar.addEventListener("mouseout", onMouseOut);
		splitter.addEventListener("mouseout", onMouseOut);
		hoverArea.addEventListener("mouseout", onMouseOut);

		//aDOMWindow.tt.ss = ss; // uncomment while debugging
		//aDOMWindow.tt.quickSearchBox = quickSearchBox; // uncomment while debugging
		//aDOMWindow.tt.newTab = newTab;
		//aDOMWindow.tt.tt = tree; // uncomment while debugging
		//aDOMWindow.tt.treechildren = treechildren; // uncomment while debugging
		//aDOMWindow.tt.tabContextMenu = tabContextMenu; // uncomment while debugging
		//aDOMWindow.tt.sidebar = sidebar; // uncomment while debugging
		//aDOMWindow.tt.customizer = aDOMWindow.document.getElementById("customization-container"); // uncomment while debugging
		//aDOMWindow.tt.treecol = treecol; // uncomment while debugging
		//aDOMWindow.tt.app = appcontent;

	} // loadIntoWindow: function(aDOMWindow)
}; // var windowListener =
