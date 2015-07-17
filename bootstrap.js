'use strict';
/* jshint moz:true */
/* global Components, Services, SessionStore, APP_SHUTDOWN */

//const {classes: Cc, interfaces: Ci, utils: Cu} = Components; // stupid WebStorm inspector doesn't understand destructuring assignment
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
var ssHack = Cu.import("resource:///modules/sessionstore/SessionStore.jsm");
var ssOrig;
const ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
//Cu.import("resource://gre/modules/AddonManager.jsm");
var drawInTitlebarOrig;

//noinspection JSUnusedGlobalSymbols
function startup(data, reason)
{
	console.log("Extension " + data.id + "(ver " + data.version + ") has been srarted up!");

	let uri = Services.io.newURI("chrome://tabstree/skin/tree.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	uri = Services.io.newURI("chrome://tabstree/skin/toolbox.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	//if( sss.sheetRegistered(uri, sss.AUTHOR_SHEET) ) { // to delete
	//	console.log("Style sheet has been registered!");
	//}

	//	// Why do we use Proxy here? Let's see the chain how SS works:
	//	// <window onload="gBrowserInit.onLoad()" /> ->
	//	// -> Services.obs.notifyObservers(window, "browser-window-before-show", ""); ->
	//	// -> SessionStore.jsm ->
	//	// -> OBSERVING.forEach(function(aTopic) { Services.obs.addObserver(this, aTopic, true); }, this); ->
	//	// -> case "browser-window-before-show": this.onBeforeBrowserWindowShown(aSubject); ->
	//	// -> SessionStoreInternal.onLoad(aWindow); ->
	//	// (1) -> Services.obs.notifyObservers(null, NOTIFY_WINDOWS_RESTORED, "");
	//	// (2) -> or just end
	//  // Here we dispatch our new event 'tt-TabsLoad'
	ssOrig = ssHack.SessionStoreInternal.onLoad;
	ssHack.SessionStoreInternal.onLoad = new Proxy(ssHack.SessionStoreInternal.onLoad, {
		apply: function(target, thisArg, argumentsList) {
			target.apply(thisArg, argumentsList); // returns nothing
			let aWindow = argumentsList[0];
			let event = new Event('tt-TabsLoad'); // we just added our event after this function is executed
			aWindow.dispatchEvent(event);
		}
	});

	drawInTitlebarOrig = Services.prefs.getBoolPref('browser.tabs.drawInTitlebar');
	
	windowListener.register();
}

//noinspection JSUnusedGlobalSymbols
function shutdown(aData, aReason)
{
	if (aReason == APP_SHUTDOWN) return;

	let uri = Services.io.newURI("chrome://tabstree/skin/tree.css", null, null);
	if( sss.sheetRegistered(uri, sss.AUTHOR_SHEET) ) {
		//console.log("Style sheet has been unregistered!"); // to delete
		sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
	}
	uri = Services.io.newURI("chrome://tabstree/skin/toolbox.css", null, null);
	if( sss.sheetRegistered(uri, sss.AUTHOR_SHEET) ) {
		sss.unregisterSheet(uri, sss.AUTHOR_SHEET);
	}

	ssHack.SessionStoreInternal.onLoad = ssOrig;
	
	windowListener.unregister();

	Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', drawInTitlebarOrig);
	
	console.log("Addon has been shut down!");
}

//noinspection JSUnusedGlobalSymbols
function install(aData, aReason) { }
//noinspection JSUnusedGlobalSymbols
function uninstall(aData, aReason) { }

//noinspection JSUnusedGlobalSymbols
var windowListener = {
	
	onOpenWindow: function (aXULWindow) {
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
		//Or:
		//if (aXULWindow.docShell instanceof Ci.nsIInterfaceRequestor) {
		//	aDOMWindow = aXULWindow.docShell.getInterface(Ci.nsIDOMWindow);
		//}
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		if (aDOMWindow.tt && aDOMWindow.tt.toRemove && aDOMWindow.tt.toRemove.observer) { // condition is needed because we also remove the observer in 'unloadFromWindow'
			Services.obs.removeObserver(aDOMWindow.tt.toRemove.observer, 'document-element-inserted');
		}
	},
	
	onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	
	register: function () {
		// Load into any existing windows
		let XULWindows = Services.wm.getXULWindowEnumerator(null);
		while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
			//windowListener.loadIntoWindowPart1(aDOMWindow, aXULWindow); // to delete
			windowListener.loadIntoWindow(aDOMWindow);
			aDOMWindow.document.querySelector('#tt-label1').value = 'entry: register'; // to delete
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
	
	//loadIntoWindow: function (aDOMWindow, aXULWindow) {
	//	if (!aDOMWindow) {
	//		return;
	//	}
	//	
	//	var browser = aDOMWindow.document.querySelector('#browser');
	//	if (browser) {
	//		
	//	} // END if (browser) {
	//}, // loadIntoWindow: function (aDOMWindow, aXULWindow) {
	
	unloadFromWindow: function (aDOMWindow, aXULWindow) {
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		//let splitter = aDOMWindow.document.querySelector('#tt-splitter'); // to delete
		//if (splitter) {
		//	let sidebar = aDOMWindow.document.querySelector('#tt-sidebar');
		//	splitter.parentNode.removeChild(splitter);
		//	sidebar.parentNode.removeChild(sidebar);
		//	//let fullscrToggler = aDOMWindow.document.querySelector('#tt-fullscr-toggler');
		//	//fullscrToggler.parentNode.removeChild(fullscrToggler);
		//}
		
		let container = aDOMWindow.document.querySelector('#tt-container');
		if (container) {
			container.parentNode.removeChild(container);
		}
		
		Object.keys(aDOMWindow.tt.toRestore.g).forEach( (x)=>{aDOMWindow.gBrowser[x] = aDOMWindow.tt.toRestore.g[x];} );
		Object.keys(aDOMWindow.tt.toRestore.TabContextMenu).forEach( (x)=>{aDOMWindow.TabContextMenu[x] = aDOMWindow.tt.toRestore.TabContextMenu[x];} ); // only 1 at the moment - 'updateContextMenu'
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabMove", aDOMWindow.tt.toRemove.eventListeners.onTabMove, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabSelect", aDOMWindow.tt.toRemove.eventListeners.onTabSelect, false);
		aDOMWindow.gBrowser.tabContainer.removeEventListener("TabAttrModified", aDOMWindow.tt.toRemove.eventListeners.onTabAttrModified, false);
		aDOMWindow.removeEventListener("sizemodechange", aDOMWindow.tt.toRemove.eventListeners.onSizemodechange, false);
		if (aDOMWindow.tt && aDOMWindow.tt.toRemove && aDOMWindow.tt.toRemove.observer) { // maybe this conditions are unnecessary
			Services.obs.removeObserver(aDOMWindow.tt.toRemove.observer, 'document-element-inserted');
		}
		// Restore default title bar buttons position (Minimize, Restore/Maximize, Close):
		let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
		let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content');
		titlebarContent.appendChild(titlebarButtonboxContainer);
		aDOMWindow.TabsInTitlebar._update(true); // It is needed to recalculate negative 'margin-bottom' for 'titlebar'
		
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
			toRemove: {eventListeners: {}},
			toRestore: {g: {}, TabContextMenu: {}}
		};

		//////////////////// TITLE BAR STANDARD BUTTONS (Minimize, Restore/Maximize, Close) ////////////////////////////
		// We can't use 'window.load' event here, because it always shows windowState==='STATE_NORMAL' even when the actual state is 'STATE_MAXIMIZED'
		let navBar = aDOMWindow.document.querySelector('#nav-bar');
		let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
		//let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content'); // to delete
		let windowControls = aDOMWindow.document.querySelector('#window-controls');
		switch (aDOMWindow.windowState) {
			case aDOMWindow.STATE_MAXIMIZED:
				navBar.appendChild(titlebarButtonboxContainer);
				Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', true);
				break;
			case aDOMWindow.STATE_NORMAL:
				Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', false);
				// TODO(me): check opening additional firefox windows
				//titlebarContent.appendChild(titlebarButtonboxContainer); // to delete
				break;
			case aDOMWindow.STATE_FULLSCREEN:
				Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', true);
				navBar.appendChild(windowControls);
				break;
		}
		//////////////////// END TITLE BAR STANDARD BUTTONS (Minimize, Restore/Maximize, Close) ////////////////////////

		////////////////////////////////////////////// MENU //////////////////////////////////////////////////////////// // to delete
		let toolbarMenubar = aDOMWindow.document.querySelector('#toolbar-menubar');
		if (toolbarMenubar.getAttribute('autohide')=='true' && toolbarMenubar.getAttribute('inactive')=='true') { // menubar is hidden
			//console.log('menubar is hidden')
			//Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', true);
		} else { // menubar is visible
			
		}
		//aDOMWindow.tt.toRemove.menuObserver = new aDOMWindow.MutationObserver(function(aMutations) {
		//	for (let mutation of aMutations) {
		//		if (mutation.attributeName == "inactive" ||
		//			mutation.attributeName == "autohide") {
		//			TabsInTitlebar._update(true);
		//			return;
		//		}
		//	}
		//});
		//if ()
		////////////////////////////////////////// END MENU ////////////////////////////////////////////////////////////

		let propsToSet;
		////////////////////////////////////////////// CONTAINER ///////////////////////////////////////////////////////
		//<hbox id="tt-container"> // needed to conveniently hide and show all my staff in fullscreen mode
		//  <vbox id="tt-fullscr-toggler"></vbox>
		//  <vbox id="tt-sidebar" width="200">
		//    <toolbox></toolbox>
		//    <tree id="tt" flex="1" seltype="single" context="tabContextMenu" treelines="true" hidecolumnpicker="true"></tree>
		//  </vbox>
		//  <splitter id="tt-splitter" />
		//</hbox>
		let container = aDOMWindow.document.createElement('hbox');
		container.setAttribute('id', 'tt-container');
		browser.insertBefore(container, aDOMWindow.document.querySelector('#appcontent')); // don't forget to remove
		////////////////////////////////////////////// CONTAINER ///////////////////////////////////////////////////////
		
		////////////////////////////////////////////// tt-fullscr-toggler //////////////////////////////////////////////
		// <vbox id="tt-fullscr-toggler"></vbox> // I am just copying what firefox does for its 'fullscr-toggler'
		let fullscrToggler = aDOMWindow.document.createElement('vbox');
		fullscrToggler.setAttribute('id', 'tt-fullscr-toggler');
		//fullscrToggler.setAttribute('hidden', ''); // to delete
		//browser.insertBefore(fullscrToggler, aDOMWindow.document.querySelector('#appcontent')); // don't forget to remove // to delete
		container.appendChild(fullscrToggler);
		//////////////////////////////////////////// END tt-fullscr-toggler ////////////////////////////////////////////

		//////////////////// VBOX ///////////////////////////////////////////////////////////////////////
		let sidebar = aDOMWindow.document.createElement('vbox');
		propsToSet = {
			id: 'tt-sidebar',
			width: '200'
			//persist: 'width' //mozilla uses persist width here, i dont know what it does and cant see it how makes a difference so i left it out
		};
		//browser.appendChild(sidebar); // to delete
		Object.keys(propsToSet).forEach( (p)=>{sidebar.setAttribute(p, propsToSet[p])} );
		//browser.insertBefore(sidebar, splitter); // to delete
		container.appendChild(sidebar);
		//////////////////// END VBOX ///////////////////////////////////////////////////////////////////////
		
		//////////////////// SPLITTER ///////////////////////////////////////////////////////////////////////
		let splitter = aDOMWindow.document.createElement('splitter');
		propsToSet = {
			id: 'tt-splitter'
			//class: 'sidebar-splitter' //im just copying what mozilla does for their social sidebar splitter
			//I left it out, but you can leave it in to see how you can style the splitter
		};
		Object.keys(propsToSet).forEach( (p)=>{splitter.setAttribute(p, propsToSet[p]);} );
		container.appendChild(splitter);
		//browser.insertBefore( splitter, aDOMWindow.document.querySelector('#appcontent') ); // to delete
		//////////////////// END SPLITTER ///////////////////////////////////////////////////////////////////////

		//////////////////// LABEL ///////////////////////////////////////////////////////////////////////
		let label1 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label1',
			value: 'tt-label1'
		};
		Object.keys(propsToSet).forEach( (p)=>{label1.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label1);
		//////////////////// END LABEL ///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 2///////////////////////////////////////////////////////////////////////
		let label2 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label2',
			value: 'tt-label2'
		};
		Object.keys(propsToSet).forEach( (p)=>{label2.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label2);
		//////////////////// END LABEL 2///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 3///////////////////////////////////////////////////////////////////////
		let label3 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label3',
			value: 'tt-label3'
		};
		Object.keys(propsToSet).forEach( (p)=>{label3.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label3);
		//////////////////// END LABEL 3///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 4///////////////////////////////////////////////////////////////////////
		let label4 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label4',
			value: 'tt-label4'
		};
		Object.keys(propsToSet).forEach( (p)=>{label4.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label4);
		//////////////////// END LABEL 4///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 5///////////////////////////////////////////////////////////////////////
		let label5 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label5',
			value: 'tt-label5'
		};
		Object.keys(propsToSet).forEach( (p)=>{label5.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label5);
		//////////////////// END LABEL 5///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 6///////////////////////////////////////////////////////////////////////
		let label6 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label6',
			value: 'tt-label6'
		};
		Object.keys(propsToSet).forEach( (p)=>{label6.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label6);
		//////////////////// END LABEL 6///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 7///////////////////////////////////////////////////////////////////////
		let label7 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label7',
			value: 'tt-label7'
		};
		Object.keys(propsToSet).forEach( (p)=>{label7.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label7);
		//////////////////// END LABEL 7///////////////////////////////////////////////////////////////////
		//////////////////// LABEL 8///////////////////////////////////////////////////////////////////////
		let label8 = aDOMWindow.document.createElement('label'); // for debugging purposes
		propsToSet = {
			id: 'tt-label8',
			value: 'tt-label8'
		};
		Object.keys(propsToSet).forEach( (p)=>{label8.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(label8);
		//////////////////// END LABEL 8///////////////////////////////////////////////////////////////////

		//////////////////// BUTTON 1 /////////////////////////////////////////////////////////////////////
		let btn1 = aDOMWindow.document.createElement('button'); // for debugging purposes
		propsToSet = {
			id: 'tt-button1',
			label: 'reboot',
			oncommand: 'btn1CommandHandler(event);'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn1.setAttribute(p, propsToSet[p]);} );
		aDOMWindow.btn1CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button1').label = 'rebooted #' + ('counter' in f ? ++f.counter : (f.counter = 1));
			for (let i=0; i<g.tabs.length; ++i) {
				ss.setTabValue(g.tabs[i], 'ttLevel', '0');
				ss.deleteTabValue(g.tabs[i], 'ttSS');
				//tree.treeBoxObject.invalidateRow(i);
			}
		};
		sidebar.appendChild(btn1);
		//////////////////// END BUTTON 1 /////////////////////////////////////////////////////////////////
		//////////////////// BUTTON 2 //////////////////////////////////////////////////////////////////////
		let btn2 = aDOMWindow.document.createElement('button'); // for debugging purposes
		propsToSet = {
			id: 'tt-button2',
			label: 'tt-button2',
			oncommand: 'btn2CommandHandler(event);'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn2.setAttribute(p, propsToSet[p]);} );
		aDOMWindow.btn2CommandHandler = function f(event) { // to delete
			aDOMWindow.document.querySelector('#tt-button2').label = 'tt-button2 #' + ('counter' in f ? ++f.counter : (f.counter = 1));
			
			//let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content'); // to delete
			//let titlebarSpacer = aDOMWindow.document.querySelector('#titlebar-spacer');
			//let tabbrowserTabs = aDOMWindow.document.querySelector('#tabbrowser-tabs');
			//let navBar = aDOMWindow.document.querySelector('#nav-bar');
			//let titlebar = aDOMWindow.document.querySelector('#titlebar');
			//let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
			////titlebarContent.removeChild(titlebarSpacer);
			////titlebarContent.insertBefore(navBar, titlebarContent.firstChild);
			//tabbrowserTabs.style.visibility = 'collapse';
			////titlebar.style.visibility = 'collapse';
			////titlebar.style.display = 'none';
			//navBar.appendChild(titlebarButtonboxContainer);
		};
		sidebar.appendChild(btn2);
		//////////////////// END BUTTON 2 //////////////////////////////////////////////////////////////////
		//////////////////// BUTTON 3 ////////////////////////////////////////////////////////////////////////
		let btn3 = aDOMWindow.document.createElement('button'); // for debugging purposes
		propsToSet = {
			id: 'tt-button3',
			label: 'tt-button3',
			oncommand: 'btn3CommandHandler(event);'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn3.setAttribute(p, propsToSet[p]);} );
		aDOMWindow.btn3CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button3').label = 'tt-button3 #' + ('counter' in f ? ++f.counter : (f.counter = 1));
			
		};
		sidebar.appendChild(btn3);
		//////////////////// END BUTTON 3 /////////////////////////////////////////////////////////////////
		//////////////////// BUTTON 4 ////////////////////////////////////////////////////////////////////////
		let btn4 = aDOMWindow.document.createElement('button'); // for debugging purposes
		propsToSet = {
			id: 'tt-button4',
			label: 'tt-button4',
			oncommand: 'btn4CommandHandler(event);'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn4.setAttribute(p, propsToSet[p]);} );
		aDOMWindow.btn4CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button4').label = 'tt-button4 #' + ('counter' in f ? ++f.counter : (f.counter = 1));

		};
		sidebar.appendChild(btn4);
		//////////////////// END BUTTON 4 /////////////////////////////////////////////////////////////////
		//////////////////// BUTTON 5 ////////////////////////////////////////////////////////////////////////
		let btn5 = aDOMWindow.document.createElement('button'); // for debugging purposes
		propsToSet = {
			id: 'tt-button5',
			label: 'Favicon',
			oncommand: 'btn5CommandHandler(event);'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn5.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(btn5);
		//////////////////// END BUTTON 5/////////////////////////////////////////////////////////////////
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
				//<toolbarseparator />
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
			treelines: 'true',
			hidecolumnpicker: 'true'
			//onmousemove: "document.querySelector('#ttLabel2').value = this.treeBoxObject.getRowAt(event.clientX, event.clientY); document.querySelector('#ttLabel3').value = this.currentIndex;", // for debug
			//onmousemove: "document.querySelector('#tt-label2').value = event.clientX - this.boxObject.x;" // for debug
		};
		Object.keys(propsToSet).forEach( (p)=>{tree.setAttribute(p, propsToSet[p]);} );
		let treecols = aDOMWindow.document.createElement('treecols'); // <treecols>
		let treecol = aDOMWindow.document.createElement('treecol'); // <treecol>
		propsToSet = {
			id: 'namecol', // to delete ??
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


//			aDOMWindow.document.querySelector('#tt').addEventListener('select', function(event) { // to delete
//				aDOMWindow.gBrowser.selectTabAtIndex(event.currentTarget.currentIndex);
//			}, false);
		//////////////////// END TREE /////////////////////////////////////////////////////////////////

		//////////////////// PANEL /////////////////////////////////////////////////////////////////////
		let panel = aDOMWindow.document.createElement('panel');
		panel.setAttribute('id', 'tt-panel');
		panel.setAttribute('style', 'opacity: 0.8');

		aDOMWindow.document.querySelector('#mainPopupSet').appendChild(panel);
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
		treeFeedback.setAttribute('treelines', 'true');
		treeFeedback.setAttribute('hidecolumnpicker', 'true');
		let treecolsFeedback = aDOMWindow.document.createElement('treecols');
		let treecolFeedback = aDOMWindow.document.createElement('treecol');
		treecolFeedback.setAttribute('flex', '1');
		treecolFeedback.setAttribute('primary', 'true');
		treecolFeedback.setAttribute('hideheader', 'true');
		let treechildrenFeedback = aDOMWindow.document.createElement('treechildren');
		treecolsFeedback.appendChild(treecolFeedback);
		treeFeedback.appendChild(treecolsFeedback);
		treeFeedback.appendChild(treechildrenFeedback);

		panel.appendChild(treeFeedback);
		//////////////////// END FEEDBACK TREE /////////////////////////////////////////////////////////////////
		
		//////////////////// QUICK SEARCH BOX ////////////////////////////////////////////////////////////////////////
		let quickSearchBox = aDOMWindow.document.createElement('textbox');
		propsToSet = {
			id: 'tt-quicksearchbox',
			placeholder: 'Quick search for tabs...'
		};
		Object.keys(propsToSet).forEach( (p)=>{quickSearchBox.setAttribute(p, propsToSet[p]);} );
		sidebar.appendChild(quickSearchBox);
		//////////////////// END QUICK SEARCH BOX /////////////////////////////////////////////////////////////////

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

			//hasAnyChildren: function(tPos) {
			//	let l = parseInt(ss.getTabValue(g.tabs[tPos], 'ttLevel'));
			//	if ( g.tabs[tPos+1] && l+1 == parseInt(ss.getTabValue(g.tabs[tPos+1], 'ttLevel')) ) {
			//		return true;
			//	}
			//	return false;
			//}, // hasAnyChildren(tPos)

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
						if ( !g.tabs[i] || this.levelInt(i)<=this.levelInt(tPosTo) ) {
							if (tPos>i) {
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
					let image = aDOMWindow.document.getAnonymousNodes(toolbarbtn)[0]; // there are sites with at least 32x32px images therefore buttons would have become huge
					image.setAttribute('height', '16px'); // we reduce such big images
					toolbarbtn.setAttribute('image', g.tabs[i].image);
				}
			}, // redrawToolbarbuttons: function() {
			
			quickSearch: function(aText, tPos) {
				if (aText && g.tabs[tPos].label.toLowerCase().indexOf(aText.toLowerCase()) != -1) {
					return true;
				}
			}
		}; // let tt = {

		tree.addEventListener('dragstart', function(event) {
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
							return tPos + '#' + ss.getTabValue(g.tabs[tPos], 'ttLevel') + ': ' + g.tabs[tPos].label;
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
						//getRowProperties: function(row,props){}, // props parameter is obsolete since Gecko 22
						//getCellProperties: function(row,col,props){}, // props parameter is obsolete since Gecko 22
						//getColumnProperties: function(colid,col,props){} // props parameter is obsolete since Gecko 22
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
			event.stopPropagation();
		}, false); // tree.addEventListener('dragstart', function(event) {

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
				}
				
				if (argumentsList.length>=2 && argumentsList[1].referrerURI) { // undo close tab hasn't got argumentsList[1]
					g.tabContainer.addEventListener('TabOpen', function onPreAddTabWithRef(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddTabWithRef, true);
						let tab = event.target;
						let oldTab = g.selectedTab;
						if (oldTab.pinned) {
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
						//tree.treeBoxObject.invalidateRow(oldTab._tPos-tt.nPinned); // redraw twisty on the parent // ????
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
					g.tabContainer.addEventListener('TabOpen', function onPreAddUndoCloseTab(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddUndoCloseTab, true);
						aDOMWindow.document.addEventListener('SSTabRestoring', function onSSing(event) {
							aDOMWindow.document.removeEventListener('SSTabRestoring', onSSing, true);
							let tab = event.originalTarget; // the tab being restored
							if (tab.pinned) {
								tt.redrawToolbarbuttons();
							} else {
								tree.treeBoxObject.rowCountChanged(tab._tPos - tt.nPinned, 1);
								// need to restore twisty
								let pTab = tt.parentTab(tab);
								if (pTab) {
									tree.treeBoxObject.invalidateRow(pTab._tPos - tt.nPinned);
								}

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
				}
			}
		}); // don't forget to restore

		//noinspection JSUnusedGlobalSymbols
		tree.view = {
			treeBox: null,
			selection: null,
			setTree: function(treeBox) { this.treeBox = treeBox; },
			get rowCount() {
				return g.tabs.length-tt.nPinned;
			},
			getCellText: function(row, column) {
				let tPos = row+tt.nPinned;
				return tPos + '#' + ss.getTabValue(g.tabs[tPos], 'ttLevel') + ': ' + g.tabs[tPos].label;
			},
			getImageSrc: function(row, column) {
				let tPos = row+tt.nPinned;
				if (g.tabs[tPos].hasAttribute('progress')) {
					return "chrome://browser/skin/tabbrowser/loading.png";
				} else if (g.tabs[tPos].hasAttribute('busy')) {
					return "chrome://browser/skin/tabbrowser/connecting.png";
				}
				return g.tabs[tPos].image;
			}, // or null to hide icons or /g.getIcon(g.tabs[row])/
			isContainer: function(row) { return true; }, // drop can be performed only on containers
			isContainerOpen: function(row) { return true; },
			isContainerEmpty: function(row) {
				let tPos = row+tt.nPinned;
				//if ( ss.getTabValue(g.tabs[tPos], "ttEmpty") == 'true' ) { // to delete
				//	return true;
				//} else {
				//	return false;
				//}
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
				let tPos = row+tt.nPinned;
				if ( tt.quickSearch(quickSearchBox.value, tPos) ) {
					return 'quickSearch';
				}
			},
			//getCellProperties: function(row,col,props){}, // props parameter is obsolete since Gecko 22
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
					// but with some effort(using dragover or mouseover default events for example) I think it can be implemented but I leave it out for now

					// We're adding a new tab.
					let newTab = g.loadOneTab(url, {inBackground: true, allowThirdPartyFixup: true});
					tt.moveTabToPlus(newTab, tPosTo, orientation);
				}
			} // drop(row, orientation, dataTransfer)
		}; // tree.view = {

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
					let tPos = argumentsList[0]._tPos;

					let toolbar = aDOMWindow.document.querySelector('#tt-toolbar');
					toolbar.removeChild(toolbar.childNodes[tPos+1]); // +1 for the arrow hbox
					ss.setTabValue(tab, 'ttLevel', '0');

					g.tabContainer.addEventListener("TabUnpinned", function onTabUnpinned(event) {
						g.tabContainer.removeEventListener("TabUnpinned", onTabUnpinned, false);

						let tPos = event.target._tPos;
						tree.treeBoxObject.rowCountChanged(tPos - tt.nPinned, 1); // the first argument is always 0
					}, false);
				}
				return target.apply(thisArg, argumentsList); // dispatches 'TabUnpinned' event
			}
		}); // don't forget to restore

		toolbar.ondragstart = function(event) {
			let toolbarbtn = event.target;
			let tPos = Array.prototype.indexOf.call(toolbarbtn.parentNode.children, toolbarbtn);
			let tab = g.tabs[tPos-1]; // the first child is the arrow hbox
			event.dataTransfer.mozSetDataAt(aDOMWindow.TAB_DROP_TYPE, tab, 0);
			event.dataTransfer.mozSetDataAt('application/x-moz-node', toolbarbtn, 0); // to delete ??
			event.dataTransfer.mozSetDataAt("text/x-moz-text-internal", tab.linkedBrowser.currentURI.spec, 0);
			event.stopPropagation();
		};

		toolbar.ondragover = function f(event) {
			let dt = event.dataTransfer;
			
			//if ( !(tab && tab.tagName == 'tab') && !dt.mozTypesAt(0).contains('text/uri-list') ) { // to delete
			//	return;
			//}

			if ( (dt.mozTypesAt(0).contains('application/x-moz-node') && dt.mozGetDataAt('application/x-moz-node', 0).tagName=='toolbarbutton'
				&& dt.mozTypesAt(0).contains(aDOMWindow.TAB_DROP_TYPE)) // rearranging pinned tabs
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
		};

		toolbar.ondragleave = function f(event) {
			event.preventDefault();
			event.stopPropagation();

			ind.collapsed = true;
		};

		toolbar.ondrop = function f(event) {
			let dt = event.dataTransfer;
			
			if ( dt.mozTypesAt(0).contains('application/x-moz-node') && dt.mozGetDataAt('application/x-moz-node', 0).tagName=='toolbarbutton'
				&& dt.mozTypesAt(0).contains(aDOMWindow.TAB_DROP_TYPE) )
			{
				// rearranging pinned tabs:
				event.preventDefault();
				event.stopPropagation();

				let sourceTab = dt.mozGetDataAt(aDOMWindow.TAB_DROP_TYPE, 0);

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
				// but with some effort(using dragover or mouseover default events for example) I think it can be implemented but I leave it out for now
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
		};

		aDOMWindow.tt.toRestore.g.removeTab = g.removeTab;
		g.removeTab =  new Proxy(g.removeTab, { // only for FLST after closing tab
			apply: function(target, thisArg, argumentsList) {
				let tab = argumentsList[0];
				if (g.mCurrentTab === tab) {
					let recentlyUsedTabs = Array.filter(g.tabs, (tab) => !tab.closing).sort((tab1, tab2) => tab2.lastAccessed - tab1.lastAccessed);
					g.selectedTab = recentlyUsedTabs[0]===g.mCurrentTab ? recentlyUsedTabs[1] : recentlyUsedTabs[0];
				}
				return target.apply(thisArg, argumentsList);
			}
		}); // don't forget to restore

		aDOMWindow.btn5CommandHandler = function f(event) { // to delete
			aDOMWindow.document.querySelector('#tt-button5').label = 'Faviconed #' + ('counter' in f ? ++f.counter : (f.counter = 1));
			tt.redrawToolbarbuttons();
		};

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
		
		quickSearchBox.oninput = function f(event) {
			tree.treeBoxObject.invalidate();
		};

		tree.onkeydown = quickSearchBox.onkeydown = function f(keyboardEvent) {
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
		// instead we using 'click' and 'keyup' events:
		tree.addEventListener('click', function f(event) {
			let idx = tree.treeBoxObject.getRowAt(event.clientX, event.clientY);
			if (idx != -1) {
				let tPos = idx + tt.nPinned;
				g.selectTabAtIndex(tPos);
			}
		}, false);
		
		tree.addEventListener('keyup', function f(event) {
			if (event.key=='ArrowUp' || event.key=='ArrowDown') {
				let tPos = tree.currentIndex + tt.nPinned;
				g.selectTabAtIndex(tPos);
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
		// label, crop, busy, image, selected"
		g.tabContainer.addEventListener("TabAttrModified", (aDOMWindow.tt.toRemove.eventListeners.onTabAttrModified = function(event) {
			let tab = event.target;
			tab.pinned ? tt.redrawToolbarbuttons() : tree.treeBoxObject.invalidateRow(tab._tPos - tt.nPinned);
		}), false); // don't forget to remove
		
		// This is needed for initial firefox load, otherwise favicons on the tree wouldn't be loaded
		// But it probably better to find another way to do initial favicon loading:
		//noinspection JSUnusedGlobalSymbols
		Services.obs.addObserver((aDOMWindow.tt.toRemove.observer = {
			observe: function f(aSubject, aTopic, aData) {
				label4.value = 'c' in f ? ++f.c : (f.c = 1); // to delete
				tree.treeBoxObject.invalidate();
			}
		}), 'document-element-inserted', false); // don't forget to remove later

		g.tabContainer.addEventListener("TabSelect", (aDOMWindow.tt.toRemove.eventListeners.onTabSelect = function(event) {
			let tab = event.target;
			tab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(tab._tPos - tt.nPinned);
			tt.redrawToolbarbuttons();
			tree.treeBoxObject.ensureRowIsVisible(tab._tPos - tt.nPinned);
		}), false); // don't forget to remove
		
		aDOMWindow.addEventListener('sizemodechange', (aDOMWindow.tt.toRemove.eventListeners.onSizemodechange = function(event) {
			let window = event.target;
			let navBar = aDOMWindow.document.querySelector('#nav-bar');
			let titlebarButtonboxContainer = aDOMWindow.document.querySelector('#titlebar-buttonbox-container');
			let titlebarContent = aDOMWindow.document.querySelector('#titlebar-content');
			let windowControls = aDOMWindow.document.querySelector('#window-controls');
			switch (window.windowState) {
				case window.STATE_MAXIMIZED:
					Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', true);
					navBar.appendChild(titlebarButtonboxContainer);
					break;
				case window.STATE_NORMAL:
					Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', false);
					titlebarContent.appendChild(titlebarButtonboxContainer);
					break;
				case window.STATE_FULLSCREEN:
					Services.prefs.setBoolPref('browser.tabs.drawInTitlebar', true);
					titlebarContent.appendChild(titlebarButtonboxContainer);
					navBar.appendChild(windowControls);
					break
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
		
		// Show on hovering in full screen mode
		let mouseoverToggle = function() {
			//gNavToolbox.style.marginTop = aShow ? "" : -gNavToolbox.getBoundingClientRect().height + "px";
		};
		fullscrToggler.addEventListener('mouseover', mouseoverToggle, false);
		fullscrToggler.addEventListener('dragenter', mouseoverToggle, false);

		tt.redrawToolbarbuttons(); // needed when addon is enabled from about:addons (not when firefox is being loaded)
		tree.treeBoxObject.invalidate(); // just in case
		// highlighting a current tree row/toolbarbutton at startup:
		g.mCurrentTab.pinned ? tree.view.selection.clearSelection() : tree.view.selection.select(g.mCurrentTab._tPos - tt.nPinned);
		tt.redrawToolbarbuttons();

		aDOMWindow.tbo = tree.treeBoxObject; // for debug
		aDOMWindow.tree = tree; // for debug
		aDOMWindow.tch = aDOMWindow.document.querySelector('#tt-treechildren'); // for debug
		//noinspection JSUnusedGlobalSymbols
		Object.defineProperty(aDOMWindow, 't', {get: function() {return g.mCurrentTab;}, configurable: true}); // for debug
	} // loadIntoWindowPart2: function(aDOMWindow) {
	
}; // var windowListener = {

/*
 * +edit comments about Obsolete tree.view methods
 * +check scroll bar handling
 * full screen mode
 * +check for about:config relatedToCurrent option. Will my addon still work?
 * +select something on startup
 * +css for tree for the selected tab
 * +check windowed mode
 * full screen hiding
 * +middle click
 * chromemargin
 * persist width of sidebar
 * hide toolbar with checkbox
 * bug with opening new windows
*/
/*
 * later:
 * tab flipping
 * pref to enable lines alongside tree
 * duplicate tab for drag and drop
 * use let draggedTab = event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);
 * use gBrowser._numPinnedTabs or gBrowser.tabContainer._lastNumPinned
 * dotted border around previously selected tab
 */
/*
 * known bugs:
 * dropping links on native tabbar
 * sometimes a loading throbber remains on the row after the page has been loaded
 */
// now doing - container