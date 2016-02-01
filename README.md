# Tab Tree for Firefox [![License](https://img.shields.io/badge/License-GPL%20v3%2B-blue.svg?style=flat-square)](https://github.com/traxium/tabtree/blob/master/LICENSE.md)

## Download, details and screenshots at https://addons.mozilla.org/en-US/firefox/addon/tab-tree/

## How to build and install

### Fast way

1. Create a folder named exactly "TabsTree@traxium" (not "TabTree@traxium", because the folder name must match the add-on ID) in "%YOUR_FIREFOX_PROFILE%/extensions/"
2. Copy all files from GitHub to that folder ("Version Notes.txt" and "README.md" aren't necessary)
3. In about:config change "xpinstall.signatures.required" to "false"
4. Restart/start Firefox
5. Enjoy

### Long way

1. Zip all files from GitHub ("Version Notes.txt" and "README.md" aren't necessary)
2. Rename that ZIP archive exactly "TabsTree@traxium.xpi" (not "TabTree@traxium.xpi", because the ZIP archive name must match the add-on ID)
3. In about:config change "xpinstall.signatures.required" to "false"
4. Drag and drop TabsTree@traxium.xpi to an open Firefox window
5. Click "Install" button in the confirmation notice
6. Enjoy

## Description

It's a Firefox extension. Tab Tree shows your tabs in the form of a tree structure. And also makes user interface compact (in height) to allow more space for the Web. It hides default tabs (at the top) and reduces the thick default borders around navigation bar. Instead the new tree tabs appear at the left:

- You can drag and drop an individual tab or a subtree of tabs
- You can drag and drop links from a web page to the tab tree
- You can drag and drop a tab to and from the pinned tabs area
- You can set the focus to address or search bar by clicking the top edge of the screen (while Firefox is maximized)
- You can click the "Go back one page" button by clicking the top left corner of the screen (while Firefox is maximized)
- You can see a previously selected tab on the tree while observing a pinned tab
- You can double click an empty area below the tabs to open a new tab/window (holding shift opens a new window)
- You can middle or double click a tab to close it (double click is disabled by default in extension preferences)
- The previous tab you were viewing gets the focus after closing a current tab (aka "Focus last selected tab")
- You can use FireGestures' "Close Tab and Focus Left Tab" and "Close Tab and Focus Right Tab" gestures
- And also you can search through the tabs (titles and URLs) using the "Tabs quick search" bar

Attention:

- You can't use "Tab Groups (Panorama)" with this extension

This extension was conceived as an alternative to Tree Style Tabs to provide better performance, stability and usability.

UPD: "Tabs Tree" was renamed to "Tab Tree" (without "-s").
