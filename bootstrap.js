/* jshint moz:true */
/* global Components, Services, SessionStore, APP_SHUTDOWN */

//const {classes: Cc, interfaces: Ci, utils: Cu} = Components; // stupid WebStorm inspector doesn't understand destructuring assignment
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/sessionstore/SessionStore.jsm");
const ss = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);
//Cu.import("resource://gre/modules/AddonManager.jsm");

//noinspection JSUnusedGlobalSymbols
function startup(data, reason)
{
	console.log("Extension " + data.id + "(ver " + data.version + ") has been srarted up!");

	let sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
	let uri = Services.io.newURI("chrome://tabstree/skin/tree.css", null, null);
	sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
	if( sss.sheetRegistered(uri, sss.AUTHOR_SHEET) ) {
		console.log("Style sheet has been loaded!");
	}

	windowListener.register();
}

//noinspection JSUnusedGlobalSymbols
function shutdown(aData, aReason)
{
	if (aReason == APP_SHUTDOWN) return;
	windowListener.unregister();
	console.log("Addon has been shut down!");
}

//noinspection JSUnusedGlobalSymbols
function install(aData, aReason) { }
//noinspection JSUnusedGlobalSymbols
function uninstall(aData, aReason) { }

//noinspection JSUnusedGlobalSymbols
var windowListener = {
	
	onOpenWindow: function (aXULWindow) {
		// Wait for the window to finish loading
		let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
		aDOMWindow.addEventListener("load", function() {
			aDOMWindow.removeEventListener("load", arguments.callee, false);
			
			windowListener.loadIntoWindowPart1(aDOMWindow, aXULWindow);
			
			// Why do we use Proxy here? Let's see the chain how SS works:
			// <window onload="gBrowserInit.onLoad()" /> ->
			// -> Services.obs.notifyObservers(window, "browser-window-before-show", ""); ->
			// -> SessionStore.jsm ->
			// -> OBSERVING.forEach(function(aTopic) { Services.obs.addObserver(this, aTopic, true); }, this); ->
			// -> case "browser-window-before-show": this.onBeforeBrowserWindowShown(aSubject); ->
			// -> SessionStoreInternal.onLoad(aWindow); ->
			// (1) -> Services.obs.notifyObservers(null, NOTIFY_WINDOWS_RESTORED, "");
			// (2) -> or just end
			
			let oldPref = Services.prefs.getBoolPref("browser.sessionstore.debug");
			Services.prefs.setBoolPref("browser.sessionstore.debug", true);
			let old = SessionStore._internal.onLoad;
			SessionStore._internal.onLoad = new Proxy(SessionStore._internal.onLoad, {
				apply: function(target, thisArg, argumentsList) {
					target.apply(thisArg, argumentsList); // returns nothing
					SessionStore._internal.onLoad = old;
					Services.prefs.setBoolPref("browser.sessionstore.debug", oldPref);
					aDOMWindow.document.querySelector('#tt-label1').value = 'entry: after _internal.onLoad()';
					windowListener.loadIntoWindowPart2(aDOMWindow); // Part2
				}
			});
			
		}, false);
	},
	
	onCloseWindow: function (aXULWindow) {},
	
	onWindowTitleChange: function (aXULWindow, aNewTitle) {},
	
	register: function () {
		// Load into any existing windows
		let XULWindows = Services.wm.getXULWindowEnumerator(null);
		while (XULWindows.hasMoreElements()) {
			let aXULWindow = XULWindows.getNext();
			let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindowInternal || Ci.nsIDOMWindow);
			windowListener.loadIntoWindowPart1(aDOMWindow, aXULWindow);
			aDOMWindow.document.querySelector('#tt-label1').value = 'entry: register';
			windowListener.loadIntoWindowPart2(aDOMWindow);
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
		//Stop listening so future added windows dont get this attached
		Services.wm.removeListener(windowListener);
	},
	
	loadIntoWindow: function (aDOMWindow, aXULWindow) {
		if (!aDOMWindow) {
			return;
		}
		
		var browser = aDOMWindow.document.querySelector('#browser');
		if (browser) {
			
		} // END if (browser) {
	}, // loadIntoWindow: function (aDOMWindow, aXULWindow) {
	
	unloadFromWindow: function (aDOMWindow, aXULWindow) {
		if (!aDOMWindow) {
			return;
		}

		let splitter = aDOMWindow.document.querySelector('#tt_splitter');
	
		if (splitter) {
			let sidebar = aDOMWindow.document.querySelector('#tt_sidebar');
			splitter.parentNode.removeChild(splitter);
			sidebar.parentNode.removeChild(sidebar);
		}
	}, // unloadFromWindow: function (aDOMWindow, aXULWindow) {
	
	loadIntoWindowPart1: function(aDOMWindow) { // here we can load something before all tabs have been loaded and restored by SS
		if (!aDOMWindow) {
			return;
		}
		let browser = aDOMWindow.document.querySelector('#browser');
		if (!browser) {
			return;
		}
		let g = aDOMWindow.gBrowser; // to delete maybe

		let propsToSet;
		//////////////////// SPLITTER ///////////////////////////////////////////////////////////////////////
		let splitter = aDOMWindow.document.createElement('splitter');
		propsToSet = {
			id: 'tt-splitter'
			//class: 'sidebar-splitter' //im just copying what mozilla does for their social sidebar splitter
			//I left it out, but you can leave it in to see how you can style the splitter
		};
		Object.keys(propsToSet).forEach( (p)=>{splitter.setAttribute(p, propsToSet[p]);} );
		//browser.appendChild(splitter);
		browser.insertBefore( splitter, aDOMWindow.document.querySelector('#appcontent') );
		//////////////////// END SPLITTER ///////////////////////////////////////////////////////////////////////

		//////////////////// VBOX ///////////////////////////////////////////////////////////////////////
		let sidebar = aDOMWindow.document.createElement('vbox');
		propsToSet = {
			id: 'tt-sidebar',
			width: '200'
			//persist: 'width' //mozilla uses persist width here, i dont know what it does and cant see it how makes a difference so i left it out
		};
		//browser.appendChild(sidebar); // to delete
		Object.keys(propsToSet).forEach( (p)=>{sidebar.setAttribute(p, propsToSet[p])} );
		browser.insertBefore(sidebar, splitter);
		//////////////////// END VBOX ///////////////////////////////////////////////////////////////////////
			
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
			type: 'panel',
			oncommand: 'btn4CommandHandler(event);'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn4.setAttribute(p, propsToSet[p]);} );
		aDOMWindow.btn4CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button4').label = 'tt-button4 #' + ('counter' in f ? ++f.counter : (f.counter = 1));

		};
		btn4.addEventListener('dragstart', function dragWithCustomImage(event) {
		  var canvas = aDOMWindow.document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
		  canvas.width = canvas.height = 50;
		
		  var ctx = canvas.getContext("2d");
		  ctx.lineWidth = 4;
		  ctx.moveTo(0, 0);
		  ctx.lineTo(50, 50);
		  ctx.moveTo(0, 50);
		  ctx.lineTo(50, 0);
		  ctx.stroke();
		
		  var dt = event.dataTransfer;
		  dt.setData('text/plain', 'Data to Drag');
		  dt.setDragImage(canvas, 25, 25);
		}, false);
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
		aDOMWindow.btn5CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button5').label = 'Faviconed #' + ('counter' in f ? ++f.counter : (f.counter = 1));
			for (let i=0; i<g.tabs.length; ++i) {
				if (g.tabs[i].pinned) {
					let toolbarbtn = aDOMWindow.document.createElement('toolbarbutton');
					toolbarbtn.setAttribute('image', g.tabs[i].image);
					toolbarbtn.setAttribute('tooltiptext', g.tabs[i].label);
					// there are sites with at least 32x32px images therefore buttons would have become huge
					toolbarbtn.setAttribute('collapsed', 'true'); // we don't want to see the size of the toolbar changing every time a site with a big icon gets pinned
					toolbar.appendChild(toolbarbtn); // anonymous nodes appear only after appendChild
					let image = aDOMWindow.document.getAnonymousNodes(toolbarbtn)[0];
					image.setAttribute('height', '16px'); // we reduce such big images
					toolbarbtn.removeAttribute('collapsed'); // and finally show it after image size became normal
				}
			}
		};

		// to delete
		sidebar.appendChild(btn5);
		btn5.ondragover = function(event) {
			event.preventDefault();
			event.stopPropagation();

			label7.value = 'dragover btn5';
		};
		btn5.ondragleave = function(event) {
			event.preventDefault();
			event.stopPropagation();

			label7.value = 'dragleave btn5';
		};
		// end to delete
		//////////////////// END BUTTON 5/////////////////////////////////////////////////////////////////
		//////////////////// DROP INDICATOR ////////////////////////////////////////////////////////////////////////
		let ind = aDOMWindow.document.getAnonymousElementByAttribute(aDOMWindow.gBrowser.tabContainer, 'anonid', 'tab-drop-indicator').cloneNode(true);
		ind.removeAttribute('anonid');
		ind.id = 'tt-drop-indicator';
		ind.collapsed = true;
		// ind.style.transform = 'scaleY(-1)'; // flip // to delete
		ind.style.marginTop = '-8px'; // needed for flipped arrow
		let hboxForDropIndicator = aDOMWindow.document.createElement('hbox');
		hboxForDropIndicator.align = 'start'; // just copying what mozilla does, but 'start' instead of 'end'
		hboxForDropIndicator.appendChild(ind);
		//////////////////// END DROP INDICATOR /////////////////////////////////////////////////////////////////
		//////////////////// TOOLBARSEPARATOR //////////////////////////////////////////////////////////////////////// // to delete
		//let toolbarseparator = aDOMWindow.document.createElement('toolbarseparator');
		//toolbarseparator.id = 'tt-toolbarseparator';
		//toolbarseparator.collapsed = true;
		//////////////////// END TOOLBARSEPARATOR /////////////////////////////////////////////////////////////////
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
		//toolbar.appendChild(toolbarseparator); // to delete
		toolbox.appendChild(toolbar);
		sidebar.appendChild(toolbox);
		//////////////////// END TOOLBOX /////////////////////////////////////////////////////////////////

		//////////////////// TREE ///////////////////////////////////////////////////////////////////////
		/*
			<tree id="tt" flex="1" seltype="single" context="tabContextMenu" onselect="selectHandler(event);">
					<treecols>
						 <treecol id="namecol" label="Name" primary="true" flex="1"/>
					</treecols>
					<treechildren/>
			</tree>
		*/
		let t = aDOMWindow.document.createElement('tree'); // <tree>
		propsToSet = {
			id: 'tt',
			flex: '1',
			seltype: 'single',
			context: 'tabContextMenu',
			treelines: 'true',
			hidecolumnpicker: "true",
			//onmousemove: "document.querySelector('#ttLabel2').value = this.treeBoxObject.getRowAt(event.clientX, event.clientY); document.querySelector('#ttLabel3').value = this.currentIndex;", // for debug
			onmousemove: "document.querySelector('#tt-label2').value = event.clientX - this.boxObject.x;" // for debug
		};
		Object.keys(propsToSet).forEach( (p)=>{t.setAttribute(p, propsToSet[p]);} );
		let treecols = aDOMWindow.document.createElement('treecols'); // <treecols>
		let treecol = aDOMWindow.document.createElement('treecol'); // <treecol>
		propsToSet = {
			id: 'namecol', // to delete ??
			flex: '1',
			primary: 'true',
			hideheader: 'true'
		};
		Object.keys(propsToSet).forEach( (p)=>{treecol.setAttribute(p, propsToSet[p]);} );
		let treechildren = aDOMWindow.document.createElement('treechildren'); // <treechildren>
		treecols.appendChild(treecol);
		t.appendChild(treecols);
		t.appendChild(treechildren);
		sidebar.appendChild(t);


//			aDOMWindow.document.querySelector('#tt').addEventListener('select', function(event) {
//				aDOMWindow.gBrowser.selectTabAtIndex(event.currentTarget.currentIndex);
//			}, false);
		//////////////////// END TREE /////////////////////////////////////////////////////////////////

		//////////////////// PANEL /////////////////////////////////////////////////////////////////////
		let panel = aDOMWindow.document.createElement('panel');
		panel.setAttribute('id', 'tt-panel');
		panel.setAttribute('style', 'opacity: 0.8');

		//let stupidLabel = aDOMWindow.document.createElement('label'); // to delete
		//stupidLabel.setAttribute('value', 'stupid label');
		//panel.appendChild(stupidLabel);

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

		//////////////////// BUTTON 6 COLLAPSED ////////////////////////////////////////////////////////////////////////
		let btn6 = aDOMWindow.document.createElement('button'); // for debugging purposes
		propsToSet = {
			id: 'tt-button6',
			label: 'collapsed panel button',
			oncommand: 'btn6CommandHandler(event);',
			type: 'panel'
			//collapsed: 'true'
		};
		Object.keys(propsToSet).forEach( (p)=>{btn6.setAttribute(p, propsToSet[p]);} );
		aDOMWindow.btn6CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button6').label = 'tt-button6 #' + ('counter' in f ? ++f.counter : (f.counter = 1));

		};
		sidebar.appendChild(btn6);
		//////////////////// END BUTTON 6 COLLAPSED /////////////////////////////////////////////////////////////////

		//noinspection JSUnusedGlobalSymbols
		Object.defineProperty(aDOMWindow, 't', { get: () => aDOMWindow.gBrowser.mCurrentTab, configurable: true}); // for debug
	}, // loadIntoWindowPart1: function(aDOMWindow) {
	
	loadIntoWindowPart2: function(aDOMWindow) {
		let g = aDOMWindow.gBrowser;
		let tree = aDOMWindow.document.querySelector('#tt');
		let panel = aDOMWindow.document.querySelector('#tt-panel');
		let treeFeedback = aDOMWindow.document.querySelector('#tt-tree-feedback');
		let label2 = aDOMWindow.document.querySelector('#tt-label2');
		let label4 = aDOMWindow.document.querySelector('#tt-label4');
		let label6 = aDOMWindow.document.querySelector('#tt-label6');
		let toolbar = aDOMWindow.document.querySelector('#tt-toolbar');
		let ind = aDOMWindow.document.querySelector('#tt-drop-indicator');

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
				//let tbbtnSource = toolbar.childNodes[aTab._tPos+1]; // +1 for the arrow correction // to delete
				//let tbbtnTo = toolbar.childNodes[tPosTo+1]; // +1 for the arrow correction // to delete
				if (mode === this.DROP_BEFORE) {
					if (aTab._tPos > tPosTo) {
						g.moveTabTo(aTab, tPosTo);
					} else if (aTab._tPos < tPosTo) {
						g.moveTabTo(aTab, tPosTo-1);
					}
					//toolbar.insertBefore(tbbtnSource, tbbtnTo); // to delete
				} else if (mode === this.DROP_AFTER) {
					if (aTab._tPos > tPosTo) {
						g.moveTabTo(aTab, tPosTo+1);
					} else if (aTab._tPos < tPosTo) {
						g.moveTabTo(aTab, tPosTo);
					}
					//toolbar.appendChild(tbbtnSource); // to delete
				} else {
					console.log('error!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'); // to delete
				}
				this.redrawToolbarbuttons();
			},
			
			redrawToolbarbuttons: function() { // It's better to redraw all toolbarbuttons every time then add one toolbarbutton at a time. There were bugs when dragging and dropping them very fast
				// first we delete all toolbarbuttons
				while (toolbar.lastChild.tagName == 'toolbarbutton') {
					toolbar.removeChild(toolbar.lastChild);
				}
				// then create new toolbarbuttons for all pinned tabs
				for (let i=0; i<this.nPinned; ++i) {
					let toolbarbtn = aDOMWindow.document.createElement('toolbarbutton');
					toolbarbtn.setAttribute('image', g.tabs[i].image);
					toolbarbtn.setAttribute('tooltiptext', g.tabs[i].label);
					// there are sites with at least 32x32px images therefore buttons would have become huge
					toolbarbtn.setAttribute('collapsed', 'true'); // we don't want to see the size of the toolbar changing every time a site with a big icon gets pinned
					toolbar.appendChild(toolbarbtn); // anonymous nodes appear only after appendChild
					let image = aDOMWindow.document.getAnonymousNodes(toolbarbtn)[0];
					image.setAttribute('height', '16px'); // we reduce such big images
					toolbarbtn.removeAttribute('collapsed'); // and finally show it after image size became normal
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

					aDOMWindow.document.querySelector('#tt-label4').value = 'popupshown'; // to delete
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
						//getRowProperties: function(row,props){}, // Obsolete since Gecko 22
						//getCellProperties: function(row,col,props){}, // Obsolete since Gecko 22
						//getColumnProperties: function(colid,col,props){} // Obsolete since Gecko 22
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
		}, false);

		for (let i=0; i<g.tabs.length; ++i) {
			if ( ss.getTabValue(g.tabs[i], 'ttLevel') === '' ) {
				ss.setTabValue(g.tabs[i], 'ttLevel', '0');
			}
		}

		g.addTab = new Proxy(g.addTab, {
			apply: function(target, thisArg, argumentsList) {
				if (argumentsList.length>=2 && argumentsList[1].referrerURI) { // undo close tab hasn't got argumentsList[1]
					g.tabContainer.addEventListener('TabOpen', function onPreAddTabWithRef(event) {
						g.tabContainer.removeEventListener('TabOpen', onPreAddTabWithRef, true);
						let tab = event.target;
						let oldTab = g.selectedTab;
						ss.setTabValue(tab, "ttLevel", (parseInt(ss.getTabValue(oldTab, 'ttLevel'))+1).toString() );
						ss.setTabValue(tab, 'ttEmpty', 'true');
						ss.setTabValue(oldTab, 'ttEmpty', 'false');
						let i;
						for (i = oldTab._tPos + 1; i < g.tabs.length - 1; ++i) { // the last is our new tab
							if ( parseInt(ss.getTabValue(g.tabs[i], 'ttLevel')) <= parseInt(ss.getTabValue(oldTab, 'ttLevel')) ) {
								g.moveTabTo(tab, i);
								break;
							}
						}
						tree.treeBoxObject.rowCountChanged(i-tt.nPinned, 1);
						tree.treeBoxObject.invalidateRow(oldTab._tPos-tt.nPinned); // redraw twisty on the parent
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
		}); // g.addTab = new Proxy(g.addTab, {

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
				let ret = target.apply(thisArg, argumentsList); // after this, "tab.pinned" is always 'false' therefore we use "pinned" which we prepared early

				//let recentlyUsedTabs = Array.filter(g.tabs, (tab) => !tab.closing).sort((tab1, tab2) => tab2.lastAccessed - tab1.lastAccessed);
				//g.selectedTab = recentlyUsedTabs[0];
				
				if (pinned) {
					tt.redrawToolbarbuttons();
				} else {
					tree.treeBoxObject.rowCountChanged(tPos - tt.nPinned, -1);
				}
				return ret;
			}
		}); // g._endRemoveTab = new Proxy(g._endRemoveTab, {

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
				return g.tabs[tPos].image;
			}, // or null to hide icons or /g.getIcon(g.tabs[row])/
			isContainer: function(row) { return true; }, // drop can be performed only on containers
			isContainerOpen: function(row) { return true; },
			isContainerEmpty: function(row) {
				let tPos = row+tt.nPinned;
				//if ( ss.getTabValue(g.tabs[tPos], "ttEmpty") == 'true' ) {
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
			//getRowProperties: function(row,props){}, // Obsolete since Gecko 22
			//getCellProperties: function(row,col,props){}, // Obsolete since Gecko 22
			//getColumnProperties: function(colid,col,props){} // Obsolete since Gecko 22
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
				//label2.value = 'drop'; // to delete
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

		aDOMWindow.btn2CommandHandler = function f(event) {
			aDOMWindow.document.querySelector('#tt-button2').label = 'tt-button2 #' + ('counter' in f ? ++f.counter : (f.counter = 1));
			//treeFeedback.treeBoxObject.view = treeFeedbackView;
		};

		//treeFeedback.treeBoxObject.view = treeFeedbackView;

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
					let toolbarbtn = aDOMWindow.document.createElement('toolbarbutton');
					toolbarbtn.setAttribute('image', event.target.image);
					toolbarbtn.setAttribute('tooltiptext', event.target.label);

					let toolbar = aDOMWindow.document.querySelector('#tt-toolbar');

					// there are sites with at least 32x32px images therefore buttons would have become huge
					toolbarbtn.setAttribute('collapsed', 'true'); // we don't want to see the size of the toolbar changing every time a site with a big icon gets pinned
					toolbar.appendChild(toolbarbtn); // anonymous nodes appear only after appendChild
					let image = aDOMWindow.document.getAnonymousNodes(toolbarbtn)[0];
					image.setAttribute('height', '16px'); // we reduce such big images
					toolbarbtn.removeAttribute('collapsed'); // and finally show it after image size became normal
				}, false);

				let row = tPos-tt.nPinned; // remember the row because after target.apply the number of pinned tabs will change(+1) and result would be different
				target.apply(thisArg, argumentsList); // dispatches 'TabPinned' event, returns nothing
				tree.treeBoxObject.rowCountChanged(row, -1);
			}
		}); // g.pinTab = new Proxy(g.pinTab, {


		g.unpinTab = new Proxy(g.unpinTab, {
			apply: function(target, thisArg, argumentsList) {
				if (argumentsList.length>0 || argumentsList[0]) { // just in case
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
		}); // g.unpinTab = new Proxy(g.unpinTab, {

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
			//label4.value = 'toolbar drag OVER #' + ('c' in f ? ++f.c : (f.c=1)); // to delete
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
			//label5.value = 'toolbar drag LEAVE #' + ('c' in f ? ++f.c : (f.c=1)) + ' ' + event.originalTarget.tagName; // to delete
		};

		toolbar.ondrop = function f(event) {
			//label6.value = 'toolbar.drop'; // to delete
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
			} else {
				console.log('error!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'); // to delete
			}
		};

		g.tabContainer.addEventListener("TabSelect", function(event) {
			tree.view.selection.select(event.target._tPos-tt.nPinned);
		}, false);
	} // loadIntoWindowPart2: function(aDOMWindow) {
	
};
/*end - windowlistener*/
/*
 * + write comment about aDOMWindow loading and SS
 * + dragstart doesn't work
 * + clean code
 * + solve problem with big pictures
 * + add dragging branches
 * + proper feedback image while dragging
 * + move everything to the left
 * + add dropping links on the tree
 * + add dropping links on the toolbar(pinned tabs bar)
 * focus LST after closing tab
 * tab flipping
 * pref to enable lines alongside tree
 * and of course selection including pinned tabs
 * move pinned tabs(toolbarbuttons)
 * use gBrowser._numPinnedTabs or gBrowser.tabContainer._lastNumPinned
 * context menu for pinned tabs(toolbarbuttons)
 * ctrl+shift+PgUp/PgDown behaviour
 * duplicate tab drop
 * + add comment about dragging type from firefox source
 * edit comments about Obsolete tree.view methods
 * check scroll bar handling
 * search box
 * + delete anonid attr
 * make negative margin relative instead of absolute in arrow
 * let draggedTab = event.dataTransfer.mozGetDataAt(TAB_DROP_TYPE, 0);
 * full screen mode
*/
/*
 * known bugs:
 * dropping links on native tabbar
 */