/*
 * This file is part of Tab Tree,
 * Copyright (C) 2015 Sergey Zelentsov <crayfishexterminator@gmail.com>
 */

/* global Components, Services */

"use strict";

//noinspection JSUnusedGlobalSymbols
var EXPORTED_SYMBOLS = ["NavBarHeight"];

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");
const OS_NAME = (function () {
    switch (Services.appinfo.OS) {
    case "WINNT":
        return "windows";
    case "Darwin":
        return "osx";
    default:
        return "linux";
    }
}());
const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);

var sizes = [24, 26, 28, 30, 32, 34, 36, 38];

var NavBarHeight = {
    
    data: null, // should be supplied from outside before init()
    packageName: "", // should be supplied from outside before init()

    stringBundle: null,
    UTIs: [],
    URIff41fix: null,
    URIff43fix: null,
    
    init: function () {
        Services.prefs.getDefaultBranch(null).setIntPref('extensions.navbarheight.height', 28);
        
        // Randomize URI to work around bug 719376:
        this.stringBundle = Services.strings.createBundle("chrome://" + this.packageName + "/locale/navbarheight.properties?" + Math.random());
        
        let moduleLocation = this.data.resourceURI.spec + "modules/NavBarHeight/";
        
        this.URIs = sizes.map((x) => Services.io.newURI(moduleLocation + OS_NAME + "/tt-navbar-" + x + ".css", null, null));
        this.URIff41fix = Services.io.newURI(moduleLocation + OS_NAME + "/tt-navbar-fix-ff41.css", null, null);
        this.URIff43fix = Services.io.newURI(moduleLocation + OS_NAME + "/tt-navbar-fix-ff43.css", null, null);
        
        this.observe(null, "nsPref:changed", "extensions.navbarheight.height");
        Services.prefs.addObserver("extensions.navbarheight.height", this, false);

        // Add the context menu option into any existing windows:
        // ATTENTION, if you add "navigator:browser" as an argument, Firefox can skip windows with any type
        // DO NOT USE getEnumerator("navigator:browser")
        let DOMWindows = Services.wm.getEnumerator(null);
        while (DOMWindows.hasMoreElements()) {
            let aDOMWindow = DOMWindows.getNext();
            if (aDOMWindow.document.querySelector("#toolbar-context-menu")) {
                // When Firefox is already opened:
                this.addOption(aDOMWindow);
            } else if (
                aDOMWindow.document.documentElement.getAttribute("windowtype") === null || // It's always null at Firefox startup
                aDOMWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser"
            ) {
                // When Firefox is starting up:
                aDOMWindow.addEventListener('load', function onLoad(event) {
                    aDOMWindow.removeEventListener('load', onLoad, false);
                    if (aDOMWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
                        NavBarHeight.addOption(aDOMWindow);
                    }
                }, false);
            }
        }
        // Listen to new windows:
        Services.wm.addListener(this);
    },

    uninit: function () {
        // Removing an observer that has already been removed won't do any harm:
        Services.prefs.removeObserver("extensions.navbarheight.height", this);
        this.URIs.forEach((x) => {
            if (sss.sheetRegistered(x, sss.AUTHOR_SHEET)) {
                sss.unregisterSheet(x, sss.AUTHOR_SHEET);
            }
        });
        if (sss.sheetRegistered(this.URIff41fix, sss.AUTHOR_SHEET)) {
            sss.unregisterSheet(this.URIff41fix, sss.AUTHOR_SHEET);
        }
        if (sss.sheetRegistered(this.URIff43fix, sss.AUTHOR_SHEET)) {
            sss.unregisterSheet(this.URIff43fix, sss.AUTHOR_SHEET);
        }

        //Stop listening:
        Services.wm.removeListener(this);
        // Remove the context menu option from any existing windows:
        let DOMWindows = Services.wm.getEnumerator("navigator:browser");
        while (DOMWindows.hasMoreElements()) {
            this.removeOption(DOMWindows.getNext());
        }
    },

    addOption: function (aDOMWindow) {
        let toolbarContextMenu = aDOMWindow.document.querySelector("#toolbar-context-menu");
        // #toolbar-context-menu isn't full when a window is just opened because some its menu items removed and added on "popupshowing"
        if (toolbarContextMenu) {
            let sizeMenu = aDOMWindow.document.createElement("menu");
            sizeMenu.id = "nbh-size-menu";
            sizeMenu.setAttribute("label", this.stringBundle.GetStringFromName("nav_bar_height"));
            toolbarContextMenu.insertBefore(sizeMenu, toolbarContextMenu.lastElementChild); // Before "Customize..."

            let sizePopup = aDOMWindow.document.createElement("menupopup");
            sizePopup.id = "nbh-size-popup";
            sizeMenu.appendChild(sizePopup);

            sizes.forEach((x) => {
                let item = aDOMWindow.document.createElement("menuitem");
                item.setAttribute("type", "checkbox");
                item.setAttribute("label", this.stringBundle.GetStringFromName(x.toString()));
                sizePopup.appendChild(item);
            });

            let menuSeparator = aDOMWindow.document.createElement("menuseparator");
            sizePopup.appendChild(menuSeparator);

            let itemDefault = aDOMWindow.document.createElement("menuitem");
            itemDefault.setAttribute("type", "checkbox");
            itemDefault.setAttribute("label", this.stringBundle.GetStringFromName("-1"));
            sizePopup.appendChild(itemDefault);

            sizePopup.addEventListener("popupshowing", (event) => {
                // "for...of loops will loop over NodeList objects correctly, in browsers that support for...of (like Firefox 13 and later):"
                for (let item of event.currentTarget.children) {
                    if (item.localName === "menuitem") {
                        item.setAttribute("checked", "false");
                    }
                }
                let pref = Services.prefs.getIntPref("extensions.navbarheight.height");
                let idx = sizes.indexOf(pref);
                if (idx === -1) {
                    event.currentTarget.lastElementChild.setAttribute("checked", "true");
                } else {
                    event.currentTarget.children[idx].setAttribute("checked", "true");
                }
            });

            sizePopup.addEventListener('command', (event) => {
                if (event.target === event.currentTarget.lastElementChild) {
                    // Default Nav Bar Height:
                    Services.prefs.setIntPref("extensions.navbarheight.height", -1);
                } else {
                    let idx = Array.prototype.indexOf.call(event.currentTarget.children, event.target);
                    Services.prefs.setIntPref("extensions.navbarheight.height", sizes[idx]);
                }
            }, false);
        }
    },

    removeOption: function (aDOMWindow) {
        if (!aDOMWindow) {
            return;
        }
        let sizeMenu = aDOMWindow.document.querySelector("#nbh-size-menu");
        if (sizeMenu) {
            sizeMenu.parentNode.removeChild(sizeMenu);
        }
    },

    /* nsIWindowMediatorListener */

    onOpenWindow: function (aXULWindow) {
        // In Gecko 7.0 nsIDOMWindow2 has been merged into nsIDOMWindow interface.
        // In Gecko 8.0 nsIDOMStorageWindow and nsIDOMWindowInternal have been merged into nsIDOMWindow interface.
        let aDOMWindow = aXULWindow.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIDOMWindow);
        aDOMWindow.addEventListener("load", function onLoad(event) {
            aDOMWindow.removeEventListener("load", onLoad, false);
            if (aDOMWindow.document.documentElement.getAttribute("windowtype") === "navigator:browser") {
                NavBarHeight.addOption(aDOMWindow);
            }
        }, false);
    },

    /* nsIObserver */

    observe: function(subject, topic, data) {
        if (topic == "nsPref:changed") {
            // unload all:
            this.URIs.forEach((x) => {
                if (sss.sheetRegistered(x, sss.AUTHOR_SHEET)) {
                    sss.unregisterSheet(x, sss.AUTHOR_SHEET);
                }
            });
            if (sss.sheetRegistered(this.URIff41fix, sss.AUTHOR_SHEET)) {
                sss.unregisterSheet(this.URIff41fix, sss.AUTHOR_SHEET);
            }
            if (sss.sheetRegistered(this.URIff43fix, sss.AUTHOR_SHEET)) {
                sss.unregisterSheet(this.URIff43fix, sss.AUTHOR_SHEET);
            }

            let pref = Services.prefs.getIntPref("extensions.navbarheight.height");
            let idx = sizes.indexOf(pref);
            if (idx !== -1) {
                sss.loadAndRegisterSheet(this.URIs[idx], sss.AUTHOR_SHEET);
                sss.loadAndRegisterSheet(this.URIff41fix, sss.AUTHOR_SHEET);
                sss.loadAndRegisterSheet(this.URIff43fix, sss.AUTHOR_SHEET);
            }
        }
    },

};