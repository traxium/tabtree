/*
 * This file is part of Tab Tree,
 * Copyright (C) 2015 Sergey Zelentsov <crayfishexterminator@gmail.com>
 */

'use strict';
/* jshint moz:true */
/* global Components, CustomizableUI, Services, SessionStore, APP_SHUTDOWN */

//const {classes: Cc, interfaces: Ci, utils: Cu} = Components; // WebStorm inspector doesn't understand destructuring assignment
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/CustomizableUI.jsm");
var ssHack = Cu.import("resource:///modules/sessionstore/SessionStore.jsm");
var ssOrig;
const ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
var stringBundle = Services.strings.createBundle('chrome://tabtree/locale/global.properties?' + Math.random()); // Randomize URI to work around bug 719376
var menuVisible;

//noinspection JSUnusedGlobalSymbols
function startup(data, reason)
{
	let uri = Services.io.newURI("chrome://tabtree/skin/tree.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	uri = Services.io.newURI("chrome://tabtree/skin/toolbox.css", null, null);
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
				let event = new Event('tt-TabsLoad'); // we just added our event after this function is executed
				aWindow.dispatchEvent(event);
			}
		});
	}

	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.treelines', true); // setting default pref
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.highlight-unloaded-tabs', 0); // setting default pref
	Services.prefs.getDefaultBranch(null).setBoolPref('extensions.tabtree.dblclick', false); // setting default pref
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.delay', 0); // setting default pref
	Services.prefs.getDefaultBranch(null).setIntPref('extensions.tabtree.position', 0); // setting default pref // 0 - Left, 1 - Right
	
	// migration code :
	try {
		Services.prefs.setBoolPref('extensions.tabtree.treelines', Services.prefs.getBoolPref('extensions.tabstree.treelines'));
		Services.prefs.setIntPref('extensions.tabtree.highlight-unloaded-tabs', Services.prefs.getIntPref('extensions.tabstree.highlight-unloaded-tabs'));
		Services.prefs.setBoolPref('extensions.tabtree.dblclick', Services.prefs.getBoolPref('extensions.tabstree.dblclick'));
		Services.prefs.setIntPref('extensions.tabtree.delay', Services.prefs.getIntPref('extensions.tabstree.delay'));
		Services.prefs.setIntPref('extensions.tabtree.position', Services.prefs.getIntPref('extensions.tabstree.position'));
		Services.prefs.deleteBranch('extensions.tabstree.');
	} catch (e) {
	}
	// - end migration code // don't forget to delete when v1.1.0 isn't in use anymore
	
	windowListener.register();
}

//noinspection JSUnusedGlobalSymbols
function shutdown(aData, aReason)
{
	if (aReason == APP_SHUTDOWN) return;

	let uri = Services.io.newURI("chrome://tabtree/skin/tree.css", null, null);
	if( sss.sheetRegistered(uri, sss.AUTHOR_SHEET) ) {
		sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
	}
	uri = Services.io.newURI("chrome://tabtree/skin/toolbox.css", null, null);
	if( sss.sheetRegistered(uri, sss.AUTHOR_SHEET) ) {
		sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
	}

	if (ssHack.SessionStoreInternal.initializeWindow) { // Fix for Firefox 41+
		ssHack.SessionStoreInternal.initializeWindow = ssOrig;
	} else { // to support Firefox before version 41
		ssHack.SessionStoreInternal.onLoad = ssOrig;
	}

	CustomizableUI.setToolbarVisibility('toolbar-menubar', menuVisible); // restoring menu visibility(in all windows)
	
	windowListener.unregister();
}

//noinspection JSUnusedGlobalSymbols
function install(aData, aReason) { }
//noinspection JSUnusedGlobalSymbols
function uninstall(aData, aReason) { }

//noinspection JSUnusedGlobalSymbols
var windowListener = {
	
	onOpenWindow: function (aXULWindow) {
		// In Gecko 7.0 nsIDOMWindow2 has been merged into nsIDOMWindow interface.
		// In Gecko 8.0 nsIDOMStorageWindow and nsIDOMWindowInternal have been merged into nsIDOMWindow interface.
		let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
		aDOMWindow.addEventListener('tt-TabsLoad', function onTabsLoad(event) {
			aDOMWindow.removeEventListener('tt-TabsLoad', onTabsLoad, false);
			
			windowListener.loadIntoWindow(aDOMWindow);
		}, false);
	},
	
	onCloseWindow: function (aXULWindow) {
		// In Gecko 7.0 nsIDOMWindow2 has been merged into nsIDOMWindow interface.
		// In Gecko 8.0 nsIDOMStorageWindow and nsIDOMWindowInternal have been merged into nsIDOMWindow interface.
		let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		let sidebar = aDOMWindow.document.querySelector('#tt-sidebar');
		ss.setWindowValue(aDOMWindow, 'tt-width', sidebar.width); // Remember the width of 'tt-sidebar'
		// Remember the first visible row of the <tree id="tt">:
		ss.setWindowValue(aDOMWindow, 'tt-first-visible-row', aDOMWindow.document.querySelector('#tt').treeBoxObject.getFirstVisibleRow().toString());
		Services.prefs.removeObserver('extensions.tabtree.treelines', aDOMWindow.tt.toRemove.prefsObserver); // it can also be removed in 'unloadFromWindow'
	},
	
	onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	
	register: function () {
		// Load into any existing windows
		let XULWindows = Services.wm.getXULWindowEnumerator(null);
		while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
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
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
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
			splitter.parentNode.removeChild(splitter);
			sidebar.parentNode.removeChild(sidebar);
			let fullscrToggler = aDOMWindow.document.querySelector('#tt-fullscr-toggler');
			fullscrToggler.parentNode.removeChild(fullscrToggler);
			let panel = aDOMWindow.document.querySelector('#tt-panel');
			panel.parentNode.removeChild(panel);
		}
		
		Object.keys(aDOMWindow.tt.toRestore.g).forEach( (x)=>{aDOMWindow.gBrowser[x] = aDOMWindow.tt.toRestore.g[x];} );
		Object.keys(aDOMWindow.tt.toRestore.TabContextMenu).forEach( (x)=>{aDOMWindow.TabContextMenu[x] = aDOMWindow.tt.toRestore.TabContextMenu[x];} ); // only 1 at the moment - 'updateContextMenu'
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabMove", aDOMWindow.tt.toRemove.eventListeners.onTabMove, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabSelect", aDOMWindow.tt.toRemove.eventListeners.onTabSelect, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabAttrModified", aDOMWindow.tt.toRemove.eventListeners.onTabAttrModified, false);
		aDOMWindow.gBrowser.removeTabsProgressListener(aDOMWindow.tt.toRemove.tabsProgressListener);
		aDOMWindow.removeEventListener("sizemodechange", aDOMWindow.tt.toRemove.eventListeners.onSizemodechange, false);
		// Restore default title bar buttons position (Minimize, Restore/Maximize, Close):
		let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
		let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content');
		titlebarContent.appendChild(titlebarButtonboxContainer);
		if (aDOMWindow.tt.toRestore.tabsintitlebar) { // restoring 'tabsintitlebar' attr
			aDOMWindow.document.documentElement.setAttribute("tabsintitlebar", "true"); // hide native titlebar
		} else {
			aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show native titlebar
		}
		aDOMWindow.TabsInTitlebar._update(true); // It is needed to recalculate negative 'margin-bottom' for 'titlebar' and 'margin-bottom' for 'titlebarContainer'
		Services.prefs.removeObserver('extensions.tabtree.treelines', aDOMWindow.tt.toRemove.prefsObserver); // it could be already removed in 'onCloseWindow'
		
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
		let g = aDOMWindow.gBrowser;
		aDOMWindow.tt = {
			toRemove: {eventListeners: {}, prefsObserver: null, tabsProgressListener: null},
			toRestore: {g: {}, TabContextMenu: {}, tabsintitlebar: true}
		};

		if (menuVisible === undefined) { // we have to remember menu visibility only once
			menuVisible = aDOMWindow.document.querySelector('#toolbar-menubar').getAttribute('autohide') != 'true'; // remember menu visibility until restart
			CustomizableUI.setToolbarVisibility('toolbar-menubar', false); // hiding menu(in all windows) in case there are users who don't know how to do that
		}
		
		// remember 'tabsintitlebar' attr before beginning to interact with it // default is 'true':
		aDOMWindow.tt.toRestore.tabsintitlebar = aDOMWindow.document.documentElement.getAttribute('tabsintitlebar')=='true';

		//////////////////// TITLE BAR STANDARD BUTTONS (Minimize, Restore/Maximize, Close) ////////////////////////////
		// We can't use 'window.load' event here, because it always shows windowState==='STATE_NORMAL' even when the actual state is 'STATE_MAXIMIZED'
		let navBar = aDOMWindow.document.querySelector('#nav-bar');
		let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
		//let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content'); // already here
		let windowControls = aDOMWindow.document.querySelector('#window-controls');
		switch (aDOMWindow.windowState) {
			case aDOMWindow.STATE_MAXIMIZED:
				navBar.appendChild(titlebarButtonboxContainer);
				aDOMWindow.document.documentElement.setAttribute("tabsintitlebar", "true"); // hide native titlebar
				aDOMWindow.updateTitlebarDisplay();
				break;
			case aDOMWindow.STATE_NORMAL:
				aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show native titlebar
				aDOMWindow.updateTitlebarDisplay();
				//titlebarContent.appendChild(titlebarButtonboxContainer); // already here
				break;
			case aDOMWindow.STATE_FULLSCREEN:
				navBar.appendChild(windowControls);
				break;
		}
		//////////////////// END TITLE BAR STANDARD BUTTONS (Minimize, Restore/Maximize, Close) ////////////////////////

		let propsToSet;
		
		//  for "Left" position:
		//  <vbox id="tt-fullscr-toggler"></vbox>
		//  <vbox id="tt-sidebar" width="200">
		//    <toolbox></toolbox>
		//    <tree id="tt" flex="1" seltype="single" context="tabContextMenu" treelines="true" hidecolumnpicker="true"></tree>
		//  </vbox>
		//  <splitter id="tt-splitter" />

		//  for "Right" position:
		//  <splitter id="tt-splitter" />
		//  <vbox id="tt-fullscr-toggler"></vbox>
		//  <vbox id="tt-sidebar" width="200">
		//    <toolbox></toolbox>
		//    <tree id="tt" flex="1" seltype="single" context="tabContextMenu" treelines="true" hidecolumnpicker="true"></tree>
		//  </vbox>
		
		////////////////////////////////////////// VBOX tt-fullscr-toggler /////////////////////////////////////////////
		// <vbox id="tt-fullscr-toggler"></vbox> // I am just copying what firefox does for its 'fullscr-toggler'
		let fullscrToggler = aDOMWindow.document.createElement('vbox');
		fullscrToggler.setAttribute('id', 'tt-fullscr-toggler');
		// added later
		//////////////////////////////////////// END VBOX tt-fullscr-toggler ///////////////////////////////////////////
		
		//////////////////// VBOX ///////////////////////////////////////////////////////////////////////
		let sidebar = aDOMWindow.document.createElement('vbox');
		propsToSet = {
			id: 'tt-sidebar',
			width: ss.getWindowValue(aDOMWindow, 'tt-width') || '200'
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
		
		if (Services.prefs.getIntPref('extensions.tabtree.position') == 1) {
			browser.appendChild(fullscrToggler);
			browser.appendChild(splitter);
			browser.appendChild(sidebar);
		} else {
			browser.insertBefore(fullscrToggler, aDOMWindow.document.querySelector('#appcontent')); // don't forget to remove
			browser.insertBefore(sidebar, aDOMWindow.document.querySelector('#appcontent')); // don't forget to remove
			browser.insertBefore(splitter, aDOMWindow.document.querySelector('#appcontent'));
		}

		//////////////////// QUICK SEARCH BOX ////////////////////////////////////////////////////////////////////////
		let quickSearchBox = aDOMWindow.document.createElement('textbox');
		propsToSet = {
			id: 'tt-quicksearchbox',
			placeholder: stringBundle.GetStringFromName('tabs_quick_search') || 'Tabs quick search...' // the latter is just in case
		};
		Object.keys(propsToSet).forEach( (p)=>{quickSearchBox.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(quickSearchBox);
		//////////////////// END QUICK SEARCH BOX /////////////////////////////////////////////////////////////////
		
		//////////////////// DROP INDICATOR ////////////////////////////////////////////////////////////////////////
		let ind = aDOMWindow.document.getAnonymousElementByAttribute(aDOMWindow.gBrowser.tabContainer, 'anonid', 'tab-drop-indicator').cloneNode(true);
		ind.removeAttribute('anonid');
		ind.id = 'tt-drop-indicator';
		ind.collapsed = true;
		ind.style.marginTop = '-8px'; // needed for flipped arrow
		let hboxForDropIndicator = aDOMWindow.document.createElement('hbox');
		hboxForDropIndicator.align = 'start'; // just copying what mozilla does, but 'start' instead of 'end'
		hboxForDropIndicator.appendChild(ind);
		//////////////////// END DROP INDICATOR /////////////////////////////////////////////////////////////////
		
		//////////////////// TOOLBOX /////////////////////////////////////////////////////////////////
		/*
		<toolbox>
			<toolbar id="tt-toolbar">
				<hbox align="start">
					<img id="tt-drop-indicator" style="margin-top:-8px"/>
				</hbox>
				<toolbarbutton />
				<toolbarbutton />
				<toolbarbutton />
				<toolbarbutton />
				...
			</toolbar>
		</toolbox>
		*/
		let toolbox = aDOMWindow.document.createElement('toolbox');
		let toolbar = aDOMWindow.document.createElement('toolbar');
		toolbar.setAttribute('id', 'tt-toolbar');
		toolbar.appendChild(hboxForDropIndicator);
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
		let treecol = aDOMWindow.document.createElement('treecol'); // <treecol>
		propsToSet = {
			id: 'tt-col',
			flex: '1',
			primary: 'true',
			hideheader: 'true'
		};
		Object.keys(propsToSet).forEach( (p)=>{treecol.setAttribute(p, propsToSet[p]);} );
		let treechildren = aDOMWindow.document.createElement('treechildren'); // <treechildren id="tt-treechildren">
		treechildren.setAttribute('id', 'tt-treechildren');
		treecols.appendChild(treecol);
		tree.appendChild(treecols);
		tree.appendChild(treechildren);
		sidebar.appendChild(tree);
		//////////////////// END TREE /////////////////////////////////////////////////////////////////

		//////////////////// PANEL /////////////////////////////////////////////////////////////////////
		let panel = aDOMWindow.document.createElement('panel');
		panel.setAttribute('id', 'tt-panel');
		panel.setAttribute('style', 'opacity: 0.8');
		aDOMWindow.document.querySelector('#mainPopupSet').appendChild(panel); // don't forget to delete
		//////////////////// END PANEL /////////////////////////////////////////////////////////////////

		//////////////////// FEEDBACK TREE /////////////////////////////////////////////////////////////////////
		let treeFeedback = aDOMWindow.document.createElement('tree');
		/*
		 * <tree id="tt-tree-feedback" flex="1" seltype="single" treelines="true" seltype="single">
		 * 	<treecols>
		 * 		<treecol primary="true" flex="1"/>
		 * 	</treecols>
		 * 	<treechildren/>
		 * </tree>
		 */
		treeFeedback.setAttribute('id', 'tt-tree-feedback');
		treeFeedback.setAttribute('flex', '1');
		treeFeedback.setAttribute('seltype', 'single');
		treeFeedback.setAttribute('treelines', Services.prefs.getBoolPref('extensions.tabtree.treelines').toString());
		treeFeedback.setAttribute('hidecolumnpicker', 'true');
		let treecolsFeedback = aDOMWindow.document.createElement('treecols');
		let treecolFeedback = aDOMWindow.document.createElement('treecol');
		treecolFeedback.setAttribute('flex', '1');
		treecolFeedback.setAttribute('primary', 'true');
		treecolFeedback.setAttribute('hideheader', 'true');
		let treechildrenFeedback = aDOMWindow.document.createElement('treechildren');
		treechildrenFeedback.setAttribute('id', 'tt-treechildren-feedback');
		treecolsFeedback.appendChild(treecolFeedback);
		treeFeedback.appendChild(treecolsFeedback);
		treeFeedback.appendChild(treechildrenFeedback);

		panel.appendChild(treeFeedback);
		//////////////////// END FEEDBACK TREE /////////////////////////////////////////////////////////////////

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

//////////////////////////////// here we could load something before all tabs have been loaded and restored by SS ////////////////////////////////

		let tt = {
			DROP_BEFORE: -1,
			DROP_AFTER: 1,

			get nPinned() {
				let c;
				for (c=0; c<g.tabs.length; ++c) {
					if (!g.tabs[c].pinned) {
						break;
					}
				}
				return c;
			},

			hasAnyChildren: function(tPos) {
				let l = parseInt(ss.getTabValue(g.tabs[tPos], 'ttLevel'));
				return !!( g.tabs[tPos + 1] && l + 1 == parseInt(ss.getTabValue(g.tabs[tPos + 1], 'ttLevel')) );
			}, // hasAnyChildren(tPos)

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
			}, // moveTabToPlus: function(aTab, tPosTo, mode) {

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
			}, // moveBranchToPlus: function(aTab, tPosTo, mode) {

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
			
			redrawToolbarbuttons: function() { // It's better to redraw all toolbarbuttons every time then add one toolbarbutton at a time. There were bugs when dragging and dropping them very fast
				// reusing existing toolbarbuttons
				let n = toolbar.childNodes.length - 1; // -1 for the arrow hbox
				let max = Math.max(this.nPinned, n);
				let min = Math.min(this.nPinned, n);
				for (let i=0; i<max; ++i) {
					let toolbarbtn;
					if (i<min) { // reusing existing toolbarbuttons here
						toolbarbtn = toolbar.childNodes[i+1]; // +1 for the arrow hbox
					} else if (this.nPinned > n) { // we added a new pinned tab(tabs)
						toolbarbtn = aDOMWindow.document.createElement('toolbarbutton');
						toolbar.appendChild(toolbarbtn);
					} else if (this.nPinned < n) { // we removed a pinned tab(tabs)
						toolbarbtn = toolbar.childNodes[i+1]; // +1 for the arrow hbox
						toolbar.removeChild(toolbarbtn);
						continue;
					}
					toolbarbtn.setAttribute('tooltiptext', g.tabs[i].label);
					toolbarbtn.setAttribute('type', 'radio');
					toolbarbtn.setAttribute('group', 'RadioGroup');
					toolbarbtn.setAttribute('context', 'tabContextMenu');
					toolbarbtn.checked = g.tabs[i].selected;
					let image = aDOMWindow.document.getAnonymousNodes(toolbarbtn)[0]; // there are sites with at least 32px*32px images therefore buttons would have become huge
					image.setAttribute('height', '16px'); // we reduce such big images
					image.setAttribute('width', '16px'); // also there are cases where the image is 60px*20px ('chrome://browser/skin/search-indicator.png' for example)
					if (g.tabs[i].hasAttribute('progress') && g.tabs[i].hasAttribute('busy')) {
						toolbarbtn.setAttribute('image', 'chrome://browser/skin/tabbrowser/loading.png');
					} else if (g.tabs[i].hasAttribute('busy')) {
						toolbarbtn.setAttribute('image', 'chrome://browser/skin/tabbrowser/connecting.png');
					} else {
						toolbarbtn.setAttribute('image', g.tabs[i].image || 'chrome://mozapps/skin/places/defaultFavicon.png');
					}
				}
				g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
			}, // redrawToolbarbuttons: function() {
			
			quickSearch: function(aText, tPos) {
				// I assume that this method is never invoked with aText=''
				let url = g.browsers[tPos]._userTypedValue || g.browsers[tPos].contentDocument.URL || '';
				let txt = aText.toLowerCase();
				if (g.tabs[tPos].label.toLowerCase().indexOf(txt)!=-1 || url.toLowerCase().indexOf(txt)!=-1) { // 'url.toLowerCase()' may be replaced by 'url'
					return true;
				}
			}
		}; // let tt = {

		treechildren.addEventListener('dragstart', function(event) { // if the event was attached to 'tree' then the popup would be shown while you scrolling
			let tab = g.tabs[tree.currentIndex+tt.nPinned];
			event.dataTransfer.mozSetDataAt(aDOMWindow.TAB_DROP_TYPE, tab, 0);
			// "We must not set text/x-moz-url or text/plain data here,"
			// "otherwise trying to detach the tab by dropping it on the desktop"
			// "may result in an "internet shortcut" // from tabbrowser.xml
			event.dataTransfer.mozSetDataAt("text/x-moz-text-internal", tab.linkedBrowser.currentURI.spec, 0);

			if (1 || tt.hasAnyChildren(tab._tPos)) { // remove "1" to use default feedback image
				panel.addEventListener('popupshown', function onPopupShown() {
					panel.removeEventListener('popupshown', onPopupShown);

					//noinspection JSUnusedGlobalSymbols
					treeFeedback.treeBoxObject.view = {
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
							let tPos = row + this.numStart;
							return ' ' + g.tabs[tPos].label;
						},
						getImageSrc: function (row, column) {
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
						toggleOpenState: function (row) {
							//this.treeBox.invalidateRow(row);
						}
					};
					let borderTopWidth = parseInt( aDOMWindow.getComputedStyle(treeFeedback).getPropertyValue('border-top-width') );
					let borderBottomWidth = parseInt( aDOMWindow.getComputedStyle(treeFeedback).getPropertyValue('border-bottom-width') );
					let treeFeedbackHeight = treeFeedback.treeBoxObject.rowHeight * treeFeedback.treeBoxObject.view.rowCount;
					panel.height = treeFeedbackHeight + borderTopWidth + borderBottomWidth;
				}); // treeFeedback.treeBoxObject.view = {
				panel.width = aDOMWindow.document.querySelector('#tt-sidebar').width;
				let borderLeftWidth = parseInt( aDOMWindow.getComputedStyle(tree).getPropertyValue('border-left-width') );
				let marginLeft = parseInt( aDOMWindow.getComputedStyle(tree).getPropertyValue('margin-left') );
				event.dataTransfer.setDragImage(panel, event.clientX-(tree.boxObject.x-borderLeftWidth-marginLeft)+1, -20); // I don't know why "+1"
			}
			// uncomment if you always want to highlight 'gBrowser.mCurrentTab':
			//g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
			event.stopPropagation();
		}, false); // tree.addEventListener('dragstart', function(event) {
		
		tree.addEventListener('dragend', function(event) {
			if (event.dataTransfer.dropEffect == 'none') { // the drag was cancelled
				g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
			}
		}, false);

		for (let i=0; i<g.tabs.length; ++i) {
			if ( ss.getTabValue(g.tabs[i], 'ttLevel') === '' ) {
				ss.setTabValue(g.tabs[i], 'ttLevel', '0');
			}
		}

		aDOMWindow.tt.toRestore.g.addTab = g.addTab;
		g.addTab = new Proxy(g.addTab, {
			apply: function(target, thisArg, argumentsList) {
				// altering params.relatedToCurrent argument in order to ignore about:config insertRelatedAfterCurrent option:
				if (argumentsList.length == 2 && typeof argumentsList[1] == "object" && !(argumentsList[1] instanceof Ci.nsIURI)) {
					argumentsList[1].relatedToCurrent = false;
					argumentsList[1].skipAnimation = true; // I believe after disabling animation tabs are added a little bit faster
					// But I can't see the difference with the naked eye
				}
				
				if (argumentsList.length>=2 && argumentsList[1].referrerURI) { // undo close tab hasn't got argumentsList[1]
					g.tabContainer.addEventListener('TabOpen', function onPreAddTabWithRef(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddTabWithRef, true);
						let tab = event.target;
						let oldTab = g.selectedTab;
						if (oldTab.pinned) {
							ss.setTabValue(tab, 'ttLevel', '0');
							tree.treeBoxObject.rowCountChanged(g.tabs.length-1 - tt.nPinned, 1); // our new tab is at index g.tabs.length-1
						} else {
							ss.setTabValue(tab, 'ttLevel', (parseInt(ss.getTabValue(oldTab, 'ttLevel')) + 1).toString());
							let i;
							for (i = oldTab._tPos + 1; i < g.tabs.length - 1; ++i) { // the last is our new tab
								if (parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) <= parseInt(ss.getTabValue(oldTab, 'ttLevel'))) {
									g.moveTabTo(tab, i);
									break;
								}
							}
							tree.treeBoxObject.rowCountChanged(i - tt.nPinned, 1);
							// now we need to do something with a selected tree row(it has moved due to a newly added tab, it is not obvious why)
							// it only needed if we opened a new tab in background and not from pinned tab:
							tree.view.selection.select(oldTab._tPos - tt.nPinned);
						}
						tree.treeBoxObject.ensureRowIsVisible(tab._tPos - tt.nPinned);
					}, true);
				} else if (argumentsList.length>=2 && !argumentsList[1].referrerURI) { // new tab button or dropping links on the native tabbar
					g.tabContainer.addEventListener('TabOpen', function onPreAddTabWithoutRef(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddTabWithoutRef, true);
						if ( ss.getTabValue(event.target, 'ttLevel') === '' ) { // despite MDN it returns '' instead of undefined
							ss.setTabValue(event.target, 'ttLevel', '0');
						}
						tree.treeBoxObject.rowCountChanged(event.target._tPos-tt.nPinned, 1);
					}, true);
				} else { // undo close tab
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
								//if (pTab) {
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

		//noinspection JSUnusedGlobalSymbols
		let view = {
			treeBox: null,
			selection: null,
			setTree: function(treeBox) { this.treeBox = treeBox; },
			get rowCount() {
				return g.tabs.length-tt.nPinned;
			},
			getCellText: function(row, column) {
				let tPos = row+tt.nPinned;
				return ' ' + g.tabs[tPos].label;
			},
			getImageSrc: function(row, column) {
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
				let im = new aDOMWindow.Image();
				im.src = tab.image;
				if (im.complete) {
					return tab.image;
				} else {
					return 'chrome://mozapps/skin/places/defaultFavicon.png';
					// or 'chrome://tabtree/skin/completelyTransparent.png' // it would look exactly like what Firefox does for its default tabs
				}
				
				// using animated png's causes abnormal CPU load (due to too frequent rows invalidating)
				// and until this Firefox bug is fixed the following code will be commented out:
				//if (g.tabs[tPos].hasAttribute('progress') && g.tabs[tPos].hasAttribute('busy')) {
				//	return "chrome://browser/skin/tabbrowser/loading.png";
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
				if (quickSearchBox.value==='') {
					return;
				}
				let tPos = row+tt.nPinned;
				if ( tt.quickSearch(quickSearchBox.value, tPos) ) {
					return 'quickSearch';
				}
			},
			getCellProperties: function(row, col) {
				let pref = Services.prefs.getIntPref('extensions.tabtree.highlight-unloaded-tabs');
				if (pref === 0) {
					return;
				}
				let tPos = row+tt.nPinned;
				if (g.tabs[tPos].hasAttribute('pending')) {
					switch (pref) {
						case 1:
							return 'pending-grayout';
						case 2:
							return 'pending-highlight';
					}
				}
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
				let sourceTab = dataTransfer.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0); // undefined for links

				// for leaves:
				if ( dataTransfer.mozTypesAt(0)[0] === aDOMWindow.TAB_DROP_TYPE
						&& sourceTab != g.tabs[tPos] // can't drop on yourself
						&& !tt.hasAnyChildren(sourceTab._tPos) ) {
					return true;
				}

				// for branches:
				if (dataTransfer.mozTypesAt(0)[0] === aDOMWindow.TAB_DROP_TYPE && sourceTab != g.tabs[tPos]) {
					let i;
					for (i=sourceTab._tPos+1; i<g.tabs.length; ++i) {
						if (tt.levelInt(i)<=tt.levelInt(sourceTab)) {
							break;
						}
					}
					if (tPos<sourceTab._tPos || tPos>=i) {
						return true;
					}
				}
				
				// for links:
				//noinspection RedundantIfStatementJS
				if (dataTransfer.mozTypesAt(0).contains('text/uri-list')) {
					return true;
				}

				return false;
			},
			drop: function(row, orientation, dataTransfer) {
				let tPosTo = row + tt.nPinned;
				let dt = dataTransfer;
				
				if (dt.mozTypesAt(0)[0]===aDOMWindow.TAB_DROP_TYPE && dt.dropEffect==='move') {
					let sourceTab = dt.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0);
					if (tt.hasAnyChildren(sourceTab._tPos)) {
						tt.moveBranchToPlus(sourceTab, tPosTo, orientation);
					} else {
						tt.moveTabToPlus(sourceTab, tPosTo, orientation);
					}
				} else if (dt.mozTypesAt(0).contains('text/uri-list')) { // for links
					let url = dt.mozGetDataAt('URL', 0);
					
					// there is no "event" parameter therefore there is no "event.shiftKey" therefore we always load link in background
					// (unlike default behaviour where holding shift allows loading links in foreground, depending on "browser.tabs.loadInBackground" pref)
					// but with some effort (using drag-over or mouse-over default events for example) I think it can be implemented but I leave it out for now

					// We're adding a new tab.
					let newTab = g.loadOneTab(url, {inBackground: true, allowThirdPartyFixup: true});
					tt.moveTabToPlus(newTab, tPosTo, orientation);
				}
				g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned); // NEW
			} // drop(row, orientation, dataTransfer)
		}; // let view = {
		tree.view = view;

		aDOMWindow.tt.toRestore.g.pinTab = g.pinTab;
		g.pinTab = new Proxy(g.pinTab, {
			apply: function(target, thisArg, argumentsList) {
				let tab = argumentsList[0];
				if (ss.getTabValue(tab, 'ttLevel') == '') { // if there is no information about 'ttLevel' then it means SS is calling gBrowser.pinTab(newlyCreatedEmptyTab)
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
				return target.apply(thisArg, argumentsList); // dispatches 'TabUnpinned' event
			}
		}); // don't forget to restore

		toolbar.addEventListener('dragstart', function(event) {
			let toolbarbtn = event.target;
			let tPos = Array.prototype.indexOf.call(toolbarbtn.parentNode.children, toolbarbtn);
			let tab = g.tabs[tPos-1]; // the first child is the arrow hbox
			event.dataTransfer.mozSetDataAt(aDOMWindow.TAB_DROP_TYPE, tab, 0);
			event.dataTransfer.mozSetDataAt('application/x-moz-node', toolbarbtn, 0);
			event.dataTransfer.mozSetDataAt('text/x-moz-text-internal', tab.linkedBrowser.currentURI.spec, 0);
			event.stopPropagation();
		}, false);

		toolbar.addEventListener('dragover', function f(event) {
			let dt = event.dataTransfer;
			
			if ( dt.mozTypesAt(0).contains(aDOMWindow.TAB_DROP_TYPE)
				|| dt.mozTypesAt(0).contains('text/uri-list') )			// adding new pinned tab
			{
				event.preventDefault();
				event.stopPropagation();

				let rect = toolbar.getBoundingClientRect();
				let newMargin;

				if (event.originalTarget.tagName == 'toolbarbutton' || event.originalTarget.tagName == 'toolbar') {
					if (event.originalTarget.tagName == 'toolbarbutton') {
						if (event.screenX <= event.originalTarget.boxObject.screenX + event.originalTarget.boxObject.width / 2) {
							newMargin = event.originalTarget.getBoundingClientRect().left - rect.left;
						} else {
							newMargin = event.originalTarget.getBoundingClientRect().right - rect.left;
						}
					} else { // == 'toolbar'
						newMargin = toolbar.lastChild.getBoundingClientRect().right - rect.left; // there is always at least one child (<hbox> with <img> where the arrow is stored)
					}
					newMargin += ind.clientWidth / 2; // just copying what mozilla does
					ind.collapsed = false;
					ind.style.transform = "translate(" + Math.round(newMargin) + "px)" + " scaleY(-1)"; // just copying what mozilla does + flip
					ind.style.MozMarginStart = (-ind.clientWidth) + "px"; // just copying what mozilla does
				}
			}
		}, false);

		toolbar.addEventListener('dragleave', function f(event) {
			event.preventDefault();
			event.stopPropagation();

			ind.collapsed = true;
		}, false);

		toolbar.addEventListener('drop', function f(event) {
			let dt = event.dataTransfer;

			if (dt.mozTypesAt(0).contains(aDOMWindow.TAB_DROP_TYPE)) {
				// rearranging pinned tabs:
				event.preventDefault();
				event.stopPropagation();

				let sourceTab = dt.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0);

				if (!dt.mozTypesAt(0).contains('application/x-moz-node') || dt.mozGetDataAt('application/x-moz-node', 0).tagName!='toolbarbutton') {
					// moving a tab from 'tree' to 'toolbar'
					g.pinTab(sourceTab);
				}

				if (event.originalTarget.tagName == 'toolbarbutton' || event.originalTarget.tagName == 'toolbar') {
					if (event.originalTarget.tagName == 'toolbarbutton') {
						let idx = Array.prototype.indexOf.call(event.originalTarget.parentNode.children, event.originalTarget);
						let tab = g.tabs[idx-1]; // the first child is the arrow hbox
						if (event.screenX <= event.originalTarget.boxObject.screenX + event.originalTarget.boxObject.width / 2) {
							tt.movePinnedToPlus(sourceTab, tab._tPos, tt.DROP_BEFORE);
						} else {
							tt.movePinnedToPlus(sourceTab, tab._tPos, tt.DROP_AFTER);
						}
					} else if (event.originalTarget.tagName == 'toolbar') {
						tt.movePinnedToPlus(sourceTab, tt.nPinned-1, tt.DROP_AFTER);
					}
					ind.collapsed = true;
				}
			} else if (dt.mozTypesAt(0).contains('text/uri-list')) {
				// adding new pinned tab:
				// there is no "event" parameter therefore there is no "event.shiftKey" therefore we always load link in background
				// (unlike default behaviour where holding shift allows loading links in foreground, depending on "browser.tabs.loadInBackground" pref)
				// but with some effort (using drag-over or mouse-over default events for example) I think it can be implemented but I leave it out for now
				event.preventDefault();
				event.stopPropagation();

				let url = dt.mozGetDataAt('URL', 0);
				// We're adding a new tab.
				let newTab = g.loadOneTab(url, {inBackground: true, allowThirdPartyFixup: true, relatedToCurrent: false});
				g.pinTab(newTab);

				if (event.originalTarget.tagName == 'toolbarbutton' || event.originalTarget.tagName == 'toolbar') {
					if (event.originalTarget.tagName == 'toolbarbutton') {
						let idx = Array.prototype.indexOf.call(event.originalTarget.parentNode.children, event.originalTarget);
						let tab = g.tabs[idx-1]; // the first child is the arrow hbox
						if (event.screenX <= event.originalTarget.boxObject.screenX + event.originalTarget.boxObject.width / 2) {
							tt.movePinnedToPlus(newTab, tab._tPos, tt.DROP_BEFORE);
						} else {
							tt.movePinnedToPlus(newTab, tab._tPos, tt.DROP_AFTER);
						}
					} else if (event.originalTarget.tagName == 'toolbar') {
						tt.movePinnedToPlus(newTab, tt.nPinned-1, tt.DROP_AFTER);
					}
					ind.collapsed = true;
				}
			}
		}, false);

		aDOMWindow.tt.toRestore.g.removeTab = g.removeTab;
		g.removeTab =  new Proxy(g.removeTab, { // for FLST after closing tab AND for nullifying 'browser.tabs.animate' about:config pref
			apply: function(target, thisArg, argumentsList) {
				let tab = argumentsList[0];
				if (g.mCurrentTab === tab) {
					let recentlyUsedTabs = Array.filter(g.tabs, (tab) => !tab.closing).sort((tab1, tab2) => tab2.lastAccessed - tab1.lastAccessed);
					g.selectedTab = recentlyUsedTabs[0]===g.mCurrentTab ? recentlyUsedTabs[1] : recentlyUsedTabs[0];
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
				} else if (aPopupMenu.triggerNode.localName == 'toolbarbutton') {
					let tPos = Array.prototype.indexOf.call(aPopupMenu.triggerNode.parentNode.childNodes, aPopupMenu.triggerNode) - 1; // -1 for the arrow hbox
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
			tree.treeBoxObject.invalidate();
		}, false);

		tree.onkeydown = quickSearchBox.onkeydown = function(keyboardEvent) {
			if (keyboardEvent.key=='Escape') {
				quickSearchBox.value = '';
				tree.treeBoxObject.invalidate();
			}
		};
		
		// I'm just disabling all unnecessary tab movement functions:
		aDOMWindow.tt.toRestore.g.moveTabForward = g.moveTabForward;
		g.moveTabForward = new Proxy(g.moveTabForward, {
			apply: function(target, thisArg, argumentsList) {
			}
		}); // don't forget to restore
		aDOMWindow.tt.toRestore.g.moveTabBackward = g.moveTabBackward;
		g.moveTabBackward = new Proxy(g.moveTabBackward, {
			apply: function(target, thisArg, argumentsList) {
			}
		}); // don't forget to restore
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
		
		let onClickFast = function(event) {
			if (event.button === 0) { // the left button click
				let idx = tree.treeBoxObject.getRowAt(event.clientX, event.clientY);
				if (idx != -1) {
					let tPos = idx + tt.nPinned;
					g.selectTabAtIndex(tPos);
				}
			}
		};
		let onClickSlow = function f(event) { // and also double click
			if (event.button === 0) { // the left button click
				let idx = tree.treeBoxObject.getRowAt(event.clientX, event.clientY);
				if (idx != -1) {
					let tPos = idx + tt.nPinned;
					if (event.detail == 1) {
						f.timer = aDOMWindow.setTimeout(function(){g.selectTabAtIndex(tPos);}, Services.prefs.getIntPref('extensions.tabtree.delay'));
					} else if (event.detail == 2) {
						aDOMWindow.clearTimeout(f.timer);
						g.removeTab(g.tabs[tPos]);
					}
				}
			}
		};
		if (Services.prefs.getBoolPref('extensions.tabtree.dblclick')) {
			tree.addEventListener('click', onClickSlow, false);
		} else {
			tree.addEventListener('click', onClickFast, false);
		}
		
		tree.addEventListener('dblclick', function(event) {
			if (event.button === 0) { // the left button click
				let idx = tree.treeBoxObject.getRowAt(event.clientX, event.clientY);
				if (idx === -1) {
					aDOMWindow.BrowserOpenNewTabOrWindow(event);
				}
			}
		}, false);
        
		g.tabContainer.addEventListener("TabMove", (aDOMWindow.tt.toRemove.eventListeners.onTabMove = function(event) {
			let tab = event.target;
			tab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(tab._tPos - tt.nPinned);
			tt.redrawToolbarbuttons();
		}), false); // don't forget to remove
		
		toolbar.addEventListener('command', function f(event) {
			if (event.originalTarget.localName == 'toolbarbutton') {
				let tPos = Array.prototype.indexOf.call(toolbar.childNodes, event.originalTarget) - 1; // -1 for the arrow hbox
				g.selectTabAtIndex(tPos);
			}
		}, false);

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
						if (mainTree && tab.hasAttribute('busy')) {
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
			tab.pinned ? tt.redrawToolbarbuttons() : tree.treeBoxObject.invalidateRow(tab._tPos - tt.nPinned);
		}), false); // don't forget to remove

		// but it can be easily corrected it:
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
		
		aDOMWindow.addEventListener('sizemodechange', (aDOMWindow.tt.toRemove.eventListeners.onSizemodechange = function(event) {
			let window = event.target;
			let navBar = aDOMWindow.document.querySelector('#nav-bar');
			let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
			let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content');
			let windowControls = aDOMWindow.document.querySelector('#window-controls');
			switch (window.windowState) {
				case window.STATE_MAXIMIZED:
					navBar.appendChild(titlebarButtonboxContainer);
					aDOMWindow.document.documentElement.setAttribute("tabsintitlebar", "true"); // hide native titlebar
					aDOMWindow.updateTitlebarDisplay();
					break;
				case window.STATE_NORMAL:
					titlebarContent.appendChild(titlebarButtonboxContainer);
					aDOMWindow.document.documentElement.removeAttribute("tabsintitlebar"); // show native toolbar
					aDOMWindow.updateTitlebarDisplay();
					break;
				case window.STATE_FULLSCREEN:
					titlebarContent.appendChild(titlebarButtonboxContainer);
					navBar.appendChild(windowControls);
					break;
			}
		}), false); // don't forget to remove

		// Middle click to close a tab
		tree.addEventListener('click', function onMiddleClick(event) {
			if (event.button === 1) { // middle click
				let idx = tree.treeBoxObject.getRowAt(event.clientX, event.clientY);
				if (idx != -1) {
					let tPos = idx + tt.nPinned;
					g.removeTab(g.tabs[tPos]);
				}
			}
		}, false);

		//noinspection JSUnusedGlobalSymbols
		Services.prefs.addObserver('extensions.tabtree.', (aDOMWindow.tt.toRemove.prefsObserver = {
			observe: function(subject, topic, data) {
				if (topic == 'nsPref:changed') {
					switch (data) {
						case 'extensions.tabtree.dblclick':
							if (Services.prefs.getBoolPref('extensions.tabtree.dblclick')) {
								tree.removeEventListener('click', onClickFast, false);
								tree.addEventListener('click', onClickSlow, false);
							} else {
								tree.removeEventListener('click', onClickSlow, false);
								tree.addEventListener('click', onClickFast, false);
							}
							break;
						case 'extensions.tabtree.highlight-unloaded-tabs':
							tree.treeBoxObject.invalidate();
							break;
						case 'extensions.tabtree.position':
							let firstVisibleRow = tree.treeBoxObject.getFirstVisibleRow();
							if (Services.prefs.getIntPref('extensions.tabtree.position') === 1) {
								browser.appendChild(fullscrToggler);
								browser.appendChild(splitter);
								browser.appendChild(sidebar);
							} else {
								browser.insertBefore(fullscrToggler, aDOMWindow.document.querySelector('#appcontent'));
								browser.insertBefore(sidebar, aDOMWindow.document.querySelector('#appcontent'));
								browser.insertBefore(splitter, aDOMWindow.document.querySelector('#appcontent'));
							}
							tree.view = view;
							tree.treeBoxObject.scrollToRow(firstVisibleRow);
							tt.redrawToolbarbuttons();
							break;
						case 'extensions.tabtree.treelines':
							tree.setAttribute('treelines', Services.prefs.getBoolPref('extensions.tabtree.treelines').toString());
							treeFeedback.setAttribute('treelines', Services.prefs.getBoolPref('extensions.tabtree.treelines').toString());
							let hack = tree.style.borderStyle; // hack to force to redraw 'treelines'
							tree.style.borderStyle = 'none';
							tree.style.borderStyle = hack;
							tree.treeBoxObject.invalidate();
							break;
					}

				}
			}
		}), false); // don't forget to remove // it can be removed in 'onCloseWindow' or in 'unloadFromWindow'(upon addon shutdown)

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
		aDOMWindow.TabsInTitlebar._update(true);
		
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
		
	} // loadIntoWindow: function(aDOMWindow) {
	
}; // var windowListener = {