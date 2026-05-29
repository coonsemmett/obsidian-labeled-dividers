/*
 | --- 📂FILES DIVIDERS PLUGIN📄 ---
 | 
 | > Obsidian plugin that adds visual dividers above or below files and folders in the file explorer.
 | 
 | This plugin allows you to:
 | - Add/remove visual dividers above or below specific files and folders
 | - Toggle dividers on/off globally
 | - Clear all dividers at once
 | - Customize divider appearance through settings
 | 
 | Commands:
 | - Toggle files dividers on/off
 | - Clear all files dividers
 | 
 */

import { Plugin, Setting, PluginSettingTab, App, Notice, TFile, TFolder, Modal } from 'obsidian';

type LabelStyle = 'above' | 'centered' | 'chip' | 'underline' | 'section' | 'minimal' | 'tucked' | 'gradient';

const LABEL_STYLE_OPTIONS: { value: LabelStyle; letter: string; title: string; desc: string }[] = [
    { value: 'above',    letter: 'A', title: 'Above-style (default)', desc: 'Label hugs the file, thin line below as section boundary' },
    { value: 'centered', letter: 'B', title: 'Centered through line', desc: '──── LABEL ──── line passes through the label' },
    { value: 'chip',     letter: 'C', title: 'Pill / chip',           desc: 'Compact rounded chip + thin line beside it' },
    { value: 'underline',letter: 'D', title: 'Underline only',         desc: 'Label with thin underline, no separate line' },
    { value: 'section',  letter: 'E', title: 'Section header',         desc: 'Filled background + left accent bar — strongest grouping' },
    { value: 'minimal',  letter: 'F', title: 'Notion-style minimal',   desc: 'Small muted label, no caps, subtle line' },
    { value: 'tucked',   letter: 'G', title: 'Bold accent + tucked',   desc: 'Thick colored line with small label tucked top-right' },
    { value: 'gradient', letter: 'H', title: 'Soft gradient bar',      desc: 'Gradient fades through label color, no hard line' },
];

interface DividerRecord {
    itemName: string;
    itemType: 'file' | 'folder';
    position: 'above' | 'below';
    style: 'line' | 'space' | 'gradient';
    label?: string;
    labelStyle?: LabelStyle;
    labelColor?: string;
    lineColor?: string;
}

interface FilesDividersSettings {
    dividers: DividerRecord[];
    dividerColor: string;
    dividerThickness: number;
    labelColor: string;
    labelFontSize: number;
    labelUppercase: boolean;
    labelBold: boolean;
    labelItalic: boolean;
    enabled: boolean;
}

const DEFAULT_SETTINGS: FilesDividersSettings = {
    dividers: [],
    dividerColor: '#484848',
    dividerThickness: 1,
    labelColor: '#888888',
    labelFontSize: 11,
    labelUppercase: true,
    labelBold: true,
    labelItalic: false,
    enabled: true
};

function escapeForCss(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\A ');
}

function dividerKey(itemName: string, itemType: string, position: string): string {
    return `${itemType}::${position}::${itemName}`;
}

export default class FilesDividersPlugin extends Plugin {
    settings: FilesDividersSettings;
    private applyDebounce: number | null = null;
    private treeObserver: MutationObserver | null = null;

    async onload() {
        await this.loadSettings();

        // --- Add ribbon icon ---
        this.addRibbonIcon('minus', 'Toggle files dividers', () => {
            this.toggleDividers();
        });

        // --- Add command to toggle dividers ---
        this.addCommand({
            id: 'toggle-files-dividers',
            name: 'Toggle files dividers on/off',
            callback: () => {
                this.toggleDividers();
            }
        });

        // --- Add command to clear all dividers ---
        this.addCommand({
            id: 'clear-all-dividers',
            name: 'Clear all files dividers',
            callback: () => {
                this.clearAllDividers();
            }
        });

        // --- Add settings tab ---
        this.addSettingTab(new FilesDividersSettingTab(this.app, this));

        // --- Apply dividers once the workspace layout is fully built ---
        //     onLayoutReady fires after Obsidian's UI is constructed (file explorer
        //     DOM exists), OR fires synchronously if layout is already ready. Without
        //     this, the immediate apply in onload() runs BEFORE the file explorer is
        //     rendered, so addDividerClasses() can't find any folders/files to tag —
        //     CSS rules install but no DOM elements match. That's the "I have to
        //     toggle the plugin off/on for it to work after vault open" bug.
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.enabled) {
                this.applyDividers();
            }
        });

        // --- Watch for file explorer changes (theme switch, sidebar toggle, etc.) ---
        //     Debounced so rapid events coalesce into one apply.
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (this.settings.enabled) {
                    this.scheduleApply();
                }
            })
        );

        // --- Add context menu option to both files and folders ---
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder || file instanceof TFile) {
                    menu.addSeparator();
                    
                    const itemType = file instanceof TFolder ? 'folder' : 'file';
                    const itemName = file.name;
                    
                    // --- Check existing dividers for this item ---
                    const existingAbove = this.settings.dividers.find(d => 
                        d.itemName === itemName && 
                        d.itemType === itemType && 
                        d.position === 'above'
                    );
                    const existingBelow = this.settings.dividers.find(d => 
                        d.itemName === itemName && 
                        d.itemType === itemType && 
                        d.position === 'below'
                    );
                    
                    // --- Add/Edit/Remove divider above ---
                    if (existingAbove) {
                        menu.addItem((item) => {
                            item
                                .setTitle(existingAbove.label
                                    ? `Edit label above ("${existingAbove.label}")…`
                                    : 'Add label to divider above…')
                                .setIcon('text-cursor-input')
                                .onClick(() => {
                                    this.promptAndEditLabel(existingAbove);
                                });
                        });
                        menu.addItem((item) => {
                            item
                                .setTitle(existingAbove.label
                                    ? `Remove labeled divider above ("${existingAbove.label}")`
                                    : 'Remove divider above')
                                .setIcon('x')
                                .onClick(() => {
                                    this.removeDividerFromItem(itemName, itemType, 'above');
                                });
                        });
                    } else {
                        menu.addItem((item) => {
                            item
                                .setTitle('Add divider above')
                                .setIcon('minus')
                                .onClick(() => {
                                    this.addDividerToItem(itemName, itemType, 'above');
                                });
                        });
                        menu.addItem((item) => {
                            item
                                .setTitle('Add labeled divider above…')
                                .setIcon('text-cursor-input')
                                .onClick(() => {
                                    this.promptAndAddLabeledDivider(itemName, itemType, 'above');
                                });
                        });
                    }

                    // --- Add/Edit/Remove divider below ---
                    if (existingBelow) {
                        menu.addItem((item) => {
                            item
                                .setTitle(existingBelow.label
                                    ? `Edit label below ("${existingBelow.label}")…`
                                    : 'Add label to divider below…')
                                .setIcon('text-cursor-input')
                                .onClick(() => {
                                    this.promptAndEditLabel(existingBelow);
                                });
                        });
                        menu.addItem((item) => {
                            item
                                .setTitle(existingBelow.label
                                    ? `Remove labeled divider below ("${existingBelow.label}")`
                                    : 'Remove divider below')
                                .setIcon('x')
                                .onClick(() => {
                                    this.removeDividerFromItem(itemName, itemType, 'below');
                                });
                        });
                    } else {
                        menu.addItem((item) => {
                            item
                                .setTitle('Add divider below')
                                .setIcon('minus')
                                .onClick(() => {
                                    this.addDividerToItem(itemName, itemType, 'below');
                                });
                        });
                        menu.addItem((item) => {
                            item
                                .setTitle('Add labeled divider below…')
                                .setIcon('text-cursor-input')
                                .onClick(() => {
                                    this.promptAndAddLabeledDivider(itemName, itemType, 'below');
                                });
                        });
                    }

                    // --- Show remove all dividers option if any exist ---
                    if (existingAbove || existingBelow) {
                        menu.addItem((item) => {
                            item
                                .setTitle('Remove all dividers')
                                .setIcon('trash')
                                .onClick(() => {
                                    this.removeDividersFromItem(itemName, itemType);
                                });
                        });
                    }
                }
            })
        );
    }

    onunload() {
        this.teardownObserver();
        if (this.applyDebounce !== null) {
            window.clearTimeout(this.applyDebounce);
            this.applyDebounce = null;
        }
        this.removeDividers();
    }

    scheduleApply() {
        if (this.applyDebounce !== null) {
            window.clearTimeout(this.applyDebounce);
        }
        this.applyDebounce = window.setTimeout(() => {
            this.applyDebounce = null;
            this.applyDividers();
        }, 150);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        if (this.settings.enabled) {
            this.applyDividers();
        } else {
            this.removeDividers();
        }
    }

    addDividerToItem(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below', label?: string, labelStyle?: LabelStyle) {
        const exists = this.settings.dividers.find(
            d => d.itemName === itemName && d.itemType === itemType && d.position === position
        );

        if (exists) {
            new Notice(`Divider already exists ${position} ${itemType} "${itemName}"`);
            return;
        }

        const divider: DividerRecord = {
            itemName,
            itemType,
            position,
            style: 'line'
        };
        if (label && label.trim()) {
            divider.label = label.trim();
            divider.labelStyle = labelStyle ?? 'above';
        }
        this.settings.dividers.push(divider);

        this.saveSettings();
        const labelPart = divider.label ? ` ("${divider.label}")` : '';
        new Notice(`Added divider${labelPart} ${position} ${itemType} "${itemName}"`);
    }

    promptAndAddLabeledDivider(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below') {
        new LabelInputModal(this.app, '', 'above', (label, labelStyle) => {
            if (label === null) return;
            this.addDividerToItem(itemName, itemType, position, label, labelStyle);
        }).open();
    }

    promptAndEditLabel(divider: DividerRecord) {
        const currentLabel = divider.label ?? '';
        const currentStyle: LabelStyle = divider.labelStyle ?? 'above';
        new LabelInputModal(this.app, currentLabel, currentStyle, (label, labelStyle) => {
            if (label === null) return;
            divider.label = label;
            divider.labelStyle = labelStyle;
            this.saveSettings();
            new Notice(`Updated label to "${label}" (${labelStyle})`);
        }).open();
    }

    updateDividerStyle(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below', labelStyle: LabelStyle) {
        const divider = this.settings.dividers.find(
            d => d.itemName === itemName && d.itemType === itemType && d.position === position
        );
        if (!divider) return;
        divider.labelStyle = labelStyle;
        this.saveSettings();
    }

    updateDividerColor(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below', field: 'labelColor' | 'lineColor', value: string | null) {
        const divider = this.settings.dividers.find(
            d => d.itemName === itemName && d.itemType === itemType && d.position === position
        );
        if (!divider) return;
        if (value === null || value === '') {
            delete divider[field];
        } else {
            divider[field] = value;
        }
        this.saveSettings();
    }

    updateDividerLabel(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below', label: string) {
        const divider = this.settings.dividers.find(
            d => d.itemName === itemName && d.itemType === itemType && d.position === position
        );
        if (!divider) return;
        const trimmed = label.trim();
        if (trimmed) {
            divider.label = trimmed;
        } else {
            delete divider.label;
        }
        this.saveSettings();
    }

    removeDividerFromItem(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below') {
        const before = this.settings.dividers.length;
        this.settings.dividers = this.settings.dividers.filter(
            d => !(d.itemName === itemName && d.itemType === itemType && d.position === position)
        );
        
        if (this.settings.dividers.length < before) {
            this.saveSettings();
            new Notice(`Removed divider ${position} ${itemType} "${itemName}"`);
        }
    }

    removeDividersFromItem(itemName: string, itemType: 'file' | 'folder') {
        const removedCount = this.settings.dividers.length;
        this.settings.dividers = this.settings.dividers.filter(
            d => !(d.itemName === itemName && d.itemType === itemType)
        );
        const newCount = this.settings.dividers.length;
        
        if (removedCount > newCount) {
            this.saveSettings();
            new Notice(`Removed ${removedCount - newCount} divider(s) from ${itemType} "${itemName}"`);
        }
    }

    clearAllDividers() {
        if (this.settings.dividers.length === 0) {
            new Notice('No dividers to clear');
            return;
        }

        const count = this.settings.dividers.length;
        this.settings.dividers = [];
        this.saveSettings();
        new Notice(`Cleared ${count} divider(s)`);
    }

    /**
     * applyDividers — DOM-based rendering.
     * Removes any previously-injected divider elements + style sheets, then for every
     * configured divider finds the matching file/folder row and inserts a real <div>
     * sibling (before for above-position, after for below). Each div is fully styled
     * via CSS classes (one per labelStyle) and a CSS custom-property block for
     * per-divider color overrides.
     *
     * Real DOM (vs. earlier pseudo-element approach) means:
     *   - no fighting with theme's overflow:hidden on .nav-file rows
     *   - 8 visually-distinct styles can each define their own internal markup
     *   - future wishlist item #13 (click label to edit) is unlocked
     */
    applyDividers(retriesLeft: number = 5) {
        this.removeDividers();
        this.installStyles();

        if (this.settings.dividers.length === 0) {
            this.teardownObserver();
            return;
        }

        const fileExplorer = document.querySelector('.nav-files-container');
        if (!fileExplorer) {
            // Container element not in DOM yet (cold vault startup, theme swap,
            // workspace remount). Retry with backoff for up to ~1 second.
            if (retriesLeft > 0) {
                window.setTimeout(() => this.applyDividers(retriesLeft - 1), 200);
            }
            return;
        }

        let placedCount = 0;
        this.settings.dividers.forEach(divider => {
            const anchor = this.findAnchor(fileExplorer, divider);
            if (!anchor) return;
            const dividerEl = this.createDividerEl(divider);
            const parent = anchor.parentNode;
            if (!parent) return;
            if (divider.position === 'above') {
                parent.insertBefore(dividerEl, anchor);
            } else {
                parent.insertBefore(dividerEl, anchor.nextSibling);
            }
            placedCount++;
        });

        // Always (re)attach the MutationObserver so future tree changes re-apply us.
        // Covers the case where Obsidian populates folders/files AFTER onLayoutReady
        // fires — without this, dividers would be missing until the user did something
        // that fired a layout-change event.
        this.ensureObserver(fileExplorer);

        // If nothing was placed but we have configured dividers, the file tree may
        // still be populating. Retry — the observer also covers this case but explicit
        // retry gets the dividers in faster on cold startup.
        if (placedCount === 0 && retriesLeft > 0) {
            window.setTimeout(() => this.applyDividers(retriesLeft - 1), 200);
        }
    }

    /**
     * Set up a MutationObserver on the file explorer so any change to its child
     * nav-folder / nav-file nodes triggers a debounced re-apply. This catches the
     * incremental-populate case (Obsidian renders the container, then adds rows
     * asynchronously) AND post-load mutations (new file created, file renamed,
     * folder expanded). Self-protected against infinite loops by filtering
     * mutations to only those involving nav-folder/nav-file nodes — our own
     * .lbl-div insertions don't trigger because they have different classes.
     */
    ensureObserver(fileExplorer: Element) {
        if (this.treeObserver) return;
        this.treeObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type !== 'childList') continue;
                const involved: Node[] = [];
                m.addedNodes.forEach(n => involved.push(n));
                m.removedNodes.forEach(n => involved.push(n));
                const navChanged = involved.some(node => {
                    if (!(node instanceof HTMLElement)) return false;
                    return node.classList.contains('nav-folder') || node.classList.contains('nav-file');
                });
                if (navChanged) {
                    this.scheduleApply();
                    return;
                }
            }
        });
        this.treeObserver.observe(fileExplorer, { childList: true, subtree: true });
    }

    teardownObserver() {
        if (this.treeObserver) {
            this.treeObserver.disconnect();
            this.treeObserver = null;
        }
    }

    /**
     * Locate the .nav-folder / .nav-file element that matches a divider's anchor name.
     * For files we accept name-with-extension and name-without-extension on either side
     * (the explorer DOM strips extensions for visible titles in some Obsidian configs).
     */
    findAnchor(container: Element, divider: DividerRecord): HTMLElement | null {
        const itemClass = divider.itemType === 'folder' ? 'nav-folder' : 'nav-file';
        const titleClass = divider.itemType === 'folder' ? 'nav-folder-title' : 'nav-file-title';
        const candidates = container.querySelectorAll(`.${itemClass}`);
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i] as HTMLElement;
            const titleEl = candidate.querySelector(`.${titleClass}`);
            if (!titleEl) continue;
            const name = titleEl.textContent?.trim() ?? '';
            if (divider.itemType === 'file') {
                const nameNoExt = name.replace(/\.[^/.]+$/, '');
                const targetNoExt = divider.itemName.replace(/\.[^/.]+$/, '');
                if (name === divider.itemName ||
                    nameNoExt === targetNoExt ||
                    name === targetNoExt ||
                    nameNoExt === divider.itemName) {
                    return candidate;
                }
            } else if (name === divider.itemName) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * Build the divider's HTMLElement for the appropriate style.
     * Each style defines its own internal markup; CSS classes from installStyles()
     * paint the look. Per-divider colors flow through CSS custom properties so
     * overrides don't require new style rules.
     */
    createDividerEl(divider: DividerRecord): HTMLElement {
        const labelText = (divider.label ?? '').trim();
        const style: LabelStyle = divider.labelStyle ?? 'above';
        const labelColor = divider.labelColor || this.settings.labelColor;
        const lineColor = divider.lineColor || this.settings.dividerColor;

        const container = document.createElement('div');
        container.classList.add('lbl-div');
        container.classList.add(`lbl-div--pos-${divider.position}`);
        container.classList.add(labelText ? `lbl-div--${style}` : 'lbl-div--plain');
        container.setAttribute('data-key', dividerKey(divider.itemName, divider.itemType, divider.position));

        // Per-divider CSS custom properties (fall back to global settings in the stylesheet)
        container.style.setProperty('--lbl-div-label-color', labelColor);
        container.style.setProperty('--lbl-div-line-color', lineColor);
        container.style.setProperty('--lbl-div-thickness', `${this.settings.dividerThickness}px`);
        container.style.setProperty('--lbl-div-font-size', `${this.settings.labelFontSize}px`);
        container.style.setProperty('--lbl-div-font-weight', this.settings.labelBold ? '600' : '400');
        container.style.setProperty('--lbl-div-font-style', this.settings.labelItalic ? 'italic' : 'normal');
        container.style.setProperty('--lbl-div-text-transform', this.settings.labelUppercase ? 'uppercase' : 'none');
        container.style.setProperty('--lbl-div-letter-spacing', this.settings.labelUppercase ? '0.08em' : 'normal');

        if (!labelText) {
            const line = document.createElement('div');
            line.className = 'lbl-div__line';
            container.appendChild(line);
            return container;
        }

        const mkEl = (tag: string, cls: string, text?: string): HTMLElement => {
            const el = document.createElement(tag);
            el.className = cls;
            if (text !== undefined) el.textContent = text;
            return el;
        };

        switch (style) {
            case 'centered':
                container.append(
                    mkEl('div', 'lbl-div__line-side'),
                    mkEl('span', 'lbl-div__label', labelText),
                    mkEl('div', 'lbl-div__line-side')
                );
                break;
            case 'chip':
                container.append(
                    mkEl('span', 'lbl-div__chip', labelText),
                    mkEl('div', 'lbl-div__line-thin')
                );
                break;
            case 'underline':
                container.append(mkEl('span', 'lbl-div__label-underline', labelText));
                break;
            case 'section':
                container.append(
                    mkEl('div', 'lbl-div__bar'),
                    mkEl('span', 'lbl-div__label', labelText)
                );
                break;
            case 'minimal':
                container.append(
                    mkEl('div', 'lbl-div__label-soft', labelText),
                    mkEl('div', 'lbl-div__line-soft')
                );
                break;
            case 'tucked':
                container.append(
                    mkEl('span', 'lbl-div__label-tuck', labelText),
                    mkEl('div', 'lbl-div__line-thick')
                );
                break;
            case 'gradient':
                container.append(mkEl('div', 'lbl-div__label-bar', labelText));
                break;
            case 'above':
            default:
                container.append(
                    mkEl('div', 'lbl-div__label', labelText),
                    mkEl('div', 'lbl-div__line')
                );
                break;
        }
        return container;
    }

    /**
     * Inject the single base stylesheet covering all 8 label styles + plain dividers.
     * Idempotent — reuses the existing <style id="lbl-div-styles"> if already attached.
     */
    installStyles() {
        let styleEl = document.getElementById('lbl-div-styles') as HTMLStyleElement | null;
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'lbl-div-styles';
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = `
.lbl-div { display: block; user-select: none; pointer-events: none; }
.lbl-div__label, .lbl-div__label-soft, .lbl-div__label-underline,
.lbl-div__label-tuck, .lbl-div__label-bar, .lbl-div__chip {
    color: var(--lbl-div-label-color, #888);
    font-size: var(--lbl-div-font-size, 11px);
    font-weight: var(--lbl-div-font-weight, 600);
    font-style: var(--lbl-div-font-style, normal);
    text-transform: var(--lbl-div-text-transform, uppercase);
    letter-spacing: var(--lbl-div-letter-spacing, 0.08em);
    line-height: 1.2;
}
.lbl-div__line, .lbl-div__line-side, .lbl-div__line-thin,
.lbl-div__line-soft, .lbl-div__line-thick {
    background-color: var(--lbl-div-line-color, #484848);
    border-radius: 1px;
}

/* Plain divider */
.lbl-div--plain { padding: 6px 0; }
.lbl-div--plain .lbl-div__line {
    height: var(--lbl-div-thickness, 1px);
    margin: 0 12px;
    opacity: 0.7;
}

/* A — Above-style (default) */
.lbl-div--above { padding: 6px 0 4px; }
.lbl-div--above .lbl-div__label { padding: 0 12px; }
.lbl-div--above .lbl-div__line {
    height: var(--lbl-div-thickness, 1px);
    margin: 4px 12px 0;
    opacity: 0.7;
}

/* B — Centered through line */
.lbl-div--centered {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
}
.lbl-div--centered .lbl-div__line-side {
    flex: 1;
    height: var(--lbl-div-thickness, 1px);
    opacity: 0.7;
}
.lbl-div--centered .lbl-div__label { white-space: nowrap; }

/* C — Pill / chip */
.lbl-div--chip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 6px 16px;
}
.lbl-div--chip .lbl-div__chip {
    display: inline-block;
    background-color: color-mix(in srgb, var(--lbl-div-label-color, #888) 20%, transparent);
    padding: 2px 8px;
    border-radius: 999px;
    letter-spacing: 0.06em;
    font-size: calc(var(--lbl-div-font-size, 11px) - 1px);
    font-weight: 700;
}
.lbl-div--chip .lbl-div__line-thin {
    flex: 1;
    height: 1px;
    opacity: 0.5;
}

/* D — Underline only */
.lbl-div--underline { padding: 8px 16px 6px; }
.lbl-div--underline .lbl-div__label-underline {
    display: inline-block;
    border-bottom: 1px solid var(--lbl-div-line-color, #484848);
    padding-bottom: 3px;
}

/* E — Section header */
.lbl-div--section {
    position: relative;
    background-color: color-mix(in srgb, var(--lbl-div-label-color, #888) 10%, transparent);
    padding: 5px 12px 5px 14px;
    margin: 4px 0;
}
.lbl-div--section .lbl-div__bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background-color: var(--lbl-div-label-color, #888);
    border-radius: 0;
}
.lbl-div--section .lbl-div__label { font-weight: 700; }

/* F — Notion-style minimal */
.lbl-div--minimal { padding: 6px 0 4px; }
.lbl-div--minimal .lbl-div__label-soft {
    padding: 0 16px;
    font-weight: 500;
    opacity: 0.7;
    text-transform: none;
    letter-spacing: normal;
}
.lbl-div--minimal .lbl-div__line-soft {
    height: 1px;
    margin: 3px 12px 0;
    opacity: 0.4;
}

/* G — Bold accent + tucked label */
.lbl-div--tucked {
    position: relative;
    padding: 12px 12px 6px;
}
.lbl-div--tucked .lbl-div__label-tuck {
    position: absolute;
    top: -1px;
    right: 14px;
    font-size: calc(var(--lbl-div-font-size, 11px) - 1px);
    font-weight: 700;
    letter-spacing: 0.1em;
    background-color: var(--background-primary, var(--background-secondary, #1e1e1e));
    padding: 0 6px;
}
.lbl-div--tucked .lbl-div__line-thick {
    height: 2px;
    margin: 0 12px;
    background-color: var(--lbl-div-label-color, #888);
    opacity: 0.7;
}

/* H — Soft gradient bar */
.lbl-div--gradient {
    margin: 4px 0;
    padding: 5px 12px;
    background: linear-gradient(90deg,
        transparent 0%,
        color-mix(in srgb, var(--lbl-div-label-color, #888) 13%, transparent) 50%,
        transparent 100%);
    text-align: center;
}
.lbl-div--gradient .lbl-div__label-bar { letter-spacing: 0.1em; }
`;
    }

    /**
     * Remove every divider element this plugin has injected, plus its stylesheet.
     * Also scrubs the legacy pseudo-element residue from pre-1.3.0 versions in case
     * an existing install upgraded mid-session.
     */
    removeDividers() {
        document.querySelectorAll('.lbl-div').forEach(el => el.remove());
        const styleEl = document.getElementById('lbl-div-styles');
        if (styleEl) styleEl.remove();

        // Legacy cleanup (pre-1.3.0)
        const legacyStyles = document.getElementById('files-dividers-styles');
        if (legacyStyles) legacyStyles.remove();
        document.querySelectorAll('[data-item]').forEach(el => {
            el.removeAttribute('data-item');
            el.removeAttribute('data-type');
            el.classList.remove(
                'nav-folder-divider-above', 'nav-folder-divider-below',
                'nav-file-divider-above', 'nav-file-divider-below'
            );
        });
    }

    toggleDividers() {
        this.settings.enabled = !this.settings.enabled;
        this.saveSettings();
        const status = this.settings.enabled ? 'enabled' : 'disabled';
        new Notice(`Files dividers ${status}`);
    }
}

/**
 * Settings tab for Files Dividers plugin
 */
class FilesDividersSettingTab extends PluginSettingTab {
    plugin: FilesDividersPlugin;

    constructor(app: App, plugin: FilesDividersPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Labeled Dividers' });

        // --- Enable/disable toggle ---
        new Setting(containerEl)
            .setName('Enable files dividers')
            .setDesc('Turn dividers on or off globally for both files and folders')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.enabled)
                    .onChange(async (value) => {
                        this.plugin.settings.enabled = value;
                        await this.plugin.saveSettings();
                    })
            );

        // --- Divider color setting ---
        new Setting(containerEl)
            .setName('Divider color')
            .setDesc('Color of the divider lines')
            .addColorPicker(color => 
                color
                    .setValue(this.plugin.settings.dividerColor)
                    .onChange(async (value) => {
                        this.plugin.settings.dividerColor = value;
                        await this.plugin.saveSettings();
                    })
            );

        // --- Divider thickness setting ---
        new Setting(containerEl)
            .setName('Divider thickness')
            .setDesc('Thickness of divider lines in pixels')
            .addSlider(slider =>
                slider
                    .setLimits(1, 5, 1)
                    .setValue(this.plugin.settings.dividerThickness)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.dividerThickness = value;
                        await this.plugin.saveSettings();
                    })
            );

        // --- Label section ---
        containerEl.createEl('h3', { text: 'Label styling' });

        new Setting(containerEl)
            .setName('Label color')
            .setDesc('Color of section-label text on labeled dividers')
            .addColorPicker(color =>
                color
                    .setValue(this.plugin.settings.labelColor)
                    .onChange(async (value) => {
                        this.plugin.settings.labelColor = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Label font size')
            .setDesc('Size of label text in pixels')
            .addSlider(slider =>
                slider
                    .setLimits(8, 18, 1)
                    .setValue(this.plugin.settings.labelFontSize)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.labelFontSize = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Uppercase labels')
            .setDesc('Render labels in UPPERCASE with slight letter-spacing (section-header style)')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.labelUppercase)
                    .onChange(async (value) => {
                        this.plugin.settings.labelUppercase = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Bold labels')
            .setDesc('Render label text in bold weight')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.labelBold)
                    .onChange(async (value) => {
                        this.plugin.settings.labelBold = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName('Italic labels')
            .setDesc('Render label text in italics')
            .addToggle(toggle =>
                toggle
                    .setValue(this.plugin.settings.labelItalic)
                    .onChange(async (value) => {
                        this.plugin.settings.labelItalic = value;
                        await this.plugin.saveSettings();
                    })
            );

        // --- Instructions ---
        containerEl.createEl('h3', { text: 'How to use' });
        containerEl.createEl('p', {
            text: 'Right-click any file or folder in the file explorer. Pick "Add divider above/below" for a plain line, or "Add labeled divider above/below…" to attach a section name. Labels render as small section-header text with a line beneath (or above, if positioned below).'
        });

        // --- Current dividers list ---
        containerEl.createEl('h3', { text: 'Current Dividers' });

        if (this.plugin.settings.dividers.length === 0) {
            containerEl.createEl('p', { 
                text: 'No dividers configured. Right-click on files or folders to add dividers.',
                cls: 'setting-item-description'
            });
        } 
        
        else {
            const folderDividers = this.plugin.settings.dividers.filter(d => d.itemType === 'folder');
            const fileDividers = this.plugin.settings.dividers.filter(d => d.itemType === 'file');

            const renderDividerRow = (divider: DividerRecord, emoji: string) => {
                const labelDisplay = divider.label ? `"${divider.label}"` : '(no label)';
                const styleDisplay = divider.label ? ` · ${divider.labelStyle ?? 'above'}` : '';
                const setting = new Setting(containerEl)
                    .setName(`${emoji} ${divider.itemName}`)
                    .setDesc(`Divider ${divider.position} — ${labelDisplay}${styleDisplay}`);

                setting.addText(text =>
                    text
                        .setPlaceholder('Section label (blank for plain line)')
                        .setValue(divider.label ?? '')
                        .onChange(async (value) => {
                            this.plugin.updateDividerLabel(divider.itemName, divider.itemType, divider.position, value);
                        })
                );

                if (divider.label) {
                    setting.addDropdown(dropdown => {
                        LABEL_STYLE_OPTIONS.forEach(opt => {
                            dropdown.addOption(opt.value, `${opt.letter} — ${opt.title}`);
                        });
                        dropdown
                            .setValue(divider.labelStyle ?? 'above')
                            .onChange(async (value) => {
                                this.plugin.updateDividerStyle(divider.itemName, divider.itemType, divider.position, value as LabelStyle);
                                this.display();
                            });
                    }
                    );
                }

                setting.addButton(button =>
                    button
                        .setButtonText('Remove')
                        .setWarning()
                        .onClick(async () => {
                            const globalIndex = this.plugin.settings.dividers.indexOf(divider);
                            this.plugin.settings.dividers.splice(globalIndex, 1);
                            await this.plugin.saveSettings();
                            this.display();
                        })
                );

                // --- Per-divider color overrides (collapsed under a smaller "Advanced" line) ---
                const advancedRow = containerEl.createDiv();
                advancedRow.style.display = 'flex';
                advancedRow.style.gap = '12px';
                advancedRow.style.alignItems = 'center';
                advancedRow.style.fontSize = '12px';
                advancedRow.style.opacity = '0.75';
                advancedRow.style.marginBottom = '14px';
                advancedRow.style.marginLeft = '24px';

                const labelColorWrap = advancedRow.createDiv();
                labelColorWrap.style.display = 'flex';
                labelColorWrap.style.alignItems = 'center';
                labelColorWrap.style.gap = '4px';
                labelColorWrap.createSpan({ text: 'Label color override:' });
                const labelColorInput = labelColorWrap.createEl('input', { type: 'color' });
                labelColorInput.value = divider.labelColor || this.plugin.settings.labelColor;
                labelColorInput.title = divider.labelColor ? 'Override active — clear to use global' : 'Using global color';
                labelColorInput.addEventListener('change', async () => {
                    this.plugin.updateDividerColor(divider.itemName, divider.itemType, divider.position, 'labelColor', labelColorInput.value);
                });
                const labelClearBtn = labelColorWrap.createEl('button', { text: '×' });
                labelClearBtn.title = 'Clear override (use global label color)';
                labelClearBtn.style.padding = '0 6px';
                labelClearBtn.style.minHeight = '0';
                labelClearBtn.addEventListener('click', async () => {
                    this.plugin.updateDividerColor(divider.itemName, divider.itemType, divider.position, 'labelColor', null);
                    this.display();
                });

                const lineColorWrap = advancedRow.createDiv();
                lineColorWrap.style.display = 'flex';
                lineColorWrap.style.alignItems = 'center';
                lineColorWrap.style.gap = '4px';
                lineColorWrap.createSpan({ text: 'Line color override:' });
                const lineColorInput = lineColorWrap.createEl('input', { type: 'color' });
                lineColorInput.value = divider.lineColor || this.plugin.settings.dividerColor;
                lineColorInput.title = divider.lineColor ? 'Override active — clear to use global' : 'Using global color';
                lineColorInput.addEventListener('change', async () => {
                    this.plugin.updateDividerColor(divider.itemName, divider.itemType, divider.position, 'lineColor', lineColorInput.value);
                });
                const lineClearBtn = lineColorWrap.createEl('button', { text: '×' });
                lineClearBtn.title = 'Clear override (use global line color)';
                lineClearBtn.style.padding = '0 6px';
                lineClearBtn.style.minHeight = '0';
                lineClearBtn.addEventListener('click', async () => {
                    this.plugin.updateDividerColor(divider.itemName, divider.itemType, divider.position, 'lineColor', null);
                    this.display();
                });
            };

            if (folderDividers.length > 0) {
                containerEl.createEl('h4', { text: 'Folder Dividers' });
                folderDividers.forEach(divider => renderDividerRow(divider, '📁'));
            }

            if (fileDividers.length > 0) {
                containerEl.createEl('h4', { text: 'File Dividers' });
                fileDividers.forEach(divider => renderDividerRow(divider, '📄'));
            }

            // --- Clear all button ---
            new Setting(containerEl)
                .addButton(button =>
                    button
                        .setButtonText('Clear all dividers')
                        .setWarning()
                        .onClick(async () => {
                            this.plugin.clearAllDividers();
                            this.display();
                        })
                );
        }
    }
}

/**
 * Modal that prompts the user for a label string + label style.
 * Calls back with (label, labelStyle); label is null if the user cancelled or left it blank.
 */
class LabelInputModal extends Modal {
    private initialValue: string;
    private initialStyle: LabelStyle;
    private callback: (label: string | null, labelStyle: LabelStyle) => void;
    private settled: boolean = false;
    private chosenStyle: LabelStyle;

    constructor(app: App, initialValue: string, initialStyle: LabelStyle, callback: (label: string | null, labelStyle: LabelStyle) => void) {
        super(app);
        this.initialValue = initialValue;
        this.initialStyle = initialStyle;
        this.chosenStyle = initialStyle;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Section label' });
        contentEl.createEl('p', {
            text: 'Enter the section text. Leave blank to cancel.',
            cls: 'setting-item-description'
        });

        const input = contentEl.createEl('input', { type: 'text' });
        input.value = this.initialValue;
        input.placeholder = 'e.g. PROJECTS';
        input.style.width = '100%';
        input.style.marginBottom = '12px';

        // --- Style picker ---
        const styleLabel = contentEl.createEl('div', { text: 'Label style' });
        styleLabel.style.fontWeight = '500';
        styleLabel.style.marginBottom = '4px';

        const styleRow = contentEl.createDiv();
        styleRow.style.display = 'grid';
        styleRow.style.gridTemplateColumns = '1fr 1fr';
        styleRow.style.gap = '8px 16px';
        styleRow.style.marginBottom = '14px';

        const makeRadio = (value: LabelStyle, letter: string, labelText: string, descText: string) => {
            const wrap = styleRow.createEl('label');
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'flex-start';
            wrap.style.gap = '6px';
            wrap.style.cursor = 'pointer';

            const radio = wrap.createEl('input', { type: 'radio' });
            radio.name = 'labeled-divider-style';
            radio.value = value;
            radio.checked = this.chosenStyle === value;
            radio.addEventListener('change', () => {
                if (radio.checked) this.chosenStyle = value;
            });

            const labelWrap = wrap.createDiv();
            const titleEl = labelWrap.createEl('div', { text: `${letter} — ${labelText}` });
            titleEl.style.fontSize = '13px';
            const descEl = labelWrap.createEl('div', { text: descText });
            descEl.style.fontSize = '11px';
            descEl.style.opacity = '0.7';
        };

        LABEL_STYLE_OPTIONS.forEach(opt => {
            makeRadio(opt.value, opt.letter, opt.title, opt.desc);
        });

        const buttonRow = contentEl.createDiv();
        buttonRow.style.display = 'flex';
        buttonRow.style.justifyContent = 'flex-end';
        buttonRow.style.gap = '8px';

        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        const submitBtn = buttonRow.createEl('button', { text: 'Add divider', cls: 'mod-cta' });

        input.focus();
        input.select();

        const submit = () => {
            const value = input.value.trim();
            if (!value) {
                this.settle(null);
            } else {
                this.settle(value);
            }
            this.close();
        };

        const cancel = () => {
            this.settle(null);
            this.close();
        };

        submitBtn.addEventListener('click', submit);
        cancelBtn.addEventListener('click', cancel);
        input.addEventListener('keydown', (evt) => {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                submit();
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                cancel();
            }
        });
    }

    onClose() {
        if (!this.settled) {
            this.callback(null, this.chosenStyle);
            this.settled = true;
        }
        this.contentEl.empty();
    }

    private settle(value: string | null) {
        if (this.settled) return;
        this.settled = true;
        this.callback(value, this.chosenStyle);
    }
}