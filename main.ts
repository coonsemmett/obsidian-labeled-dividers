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

import { Plugin, Setting, PluginSettingTab, App, Notice, TFile, TFolder, Modal, type Menu, type MenuItem } from 'obsidian';

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

interface DividerMenuContext {
    itemName: string;
    itemType: 'file' | 'folder';
    existingAbove?: DividerRecord;
    existingBelow?: DividerRecord;
}

type MenuItemWithSubmenu = MenuItem & {
    setSubmenu?: () => Menu;
};

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

export default class FilesDividersPlugin extends Plugin {
    settings: FilesDividersSettings;

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

        // --- Inject the divider stylesheet ---
        //     Phase C renders dividers purely via CSS keyed on Obsidian's own
        //     data-path attributes, so the rules apply automatically as the file
        //     explorer renders and re-renders. There is nothing to wait for
        //     (a <style> in document.head matches rows whenever they appear), and
        //     nothing to re-apply on tree changes — so no onLayoutReady gate, no
        //     layout-change handler, no MutationObserver, no vault-event reconcile.
        if (this.settings.enabled) {
            this.refreshDividerStyles();
        }

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
                    
                    this.addDividerSubmenuOrFallback(menu, {
                        itemName,
                        itemType,
                        existingAbove,
                        existingBelow,
                    });
                }
            })
        );
    }

    private addDividerSubmenuOrFallback(menu: Menu, context: DividerMenuContext) {
        let addedSubmenu = false;

        menu.addItem((item) => {
            item
                .setTitle('Dividers')
                .setIcon('minus');

            const setSubmenu = (item as MenuItemWithSubmenu).setSubmenu;
            if (typeof setSubmenu !== 'function') {
                item.onClick(() => {
                    new Notice('Submenus are not available in this Obsidian version.');
                });
                return;
            }

            const submenu = setSubmenu.call(item);
            this.addDividerActionsToMenu(submenu, context);
            addedSubmenu = true;
        });

        if (!addedSubmenu) {
            this.addDividerActionsToMenu(menu, context);
        }
    }

    private addDividerActionsToMenu(menu: Menu, context: DividerMenuContext) {
        const { itemName, itemType, existingAbove, existingBelow } = context;

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

        menu.addSeparator();

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

        if (existingAbove || existingBelow) {
            menu.addSeparator();
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

    onunload() {
        this.removeDividers();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        if (this.settings.enabled) {
            this.refreshDividerStyles();
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
     * Phase C rendering — pure CSS, zero DOM injection.
     *
     * History: versions 1.2.4–1.3.5 painted dividers by inserting our own <div>
     * nodes between Obsidian's file-tree rows, then used a MutationObserver to
     * re-insert them whenever Obsidian rebuilt the tree (file open/close, folder
     * expand/collapse, reveal-active-file). That re-insertion loop was the root
     * cause of BOTH symptoms: flicker (our nodes blinking out and back) and the
     * scroll jump (our nodes changed the tree height, so the browser recomputed
     * scrollTop and Hugh lost his place).
     *
     * Phase C removes the loop entirely. Instead of injecting nodes, we generate a
     * single global stylesheet that targets Obsidian's OWN rows via their
     * data-path attribute (e.g. .nav-folder-title[data-path="AI"]) and paints the
     * divider with a ::before ('above') or ::after ('below') pseudo-element.
     * Because the rules live in document.head and match Obsidian's own attributes,
     * they re-apply automatically the instant a row renders — even after Obsidian
     * rebuilds the tree. Nothing of ours is ever destroyed or re-inserted, the
     * pseudo-elements paint inside reserved margin space (so they don't shift row
     * height the way injected nodes did), and there is no observer, no retry, and
     * no scroll handling. No flicker, no scroll jump, by construction.
     */
    refreshDividerStyles() {
        const styleEl = this.getDynamicStyleEl();
        const css = this.buildAllCss();
        if (styleEl.textContent !== css) {
            styleEl.textContent = css;
        }
        // Scrub anything left over from the pre-Phase-C DOM-injection approach,
        // in case a user upgrades mid-session from <= 1.3.5.
        document.querySelectorAll('.lbl-div').forEach(el => el.remove());
        const legacyBase = document.getElementById('lbl-div-styles');
        if (legacyBase) legacyBase.remove();
    }

    private getDynamicStyleEl(): HTMLStyleElement {
        let el = document.getElementById('lbl-div-dynamic') as HTMLStyleElement | null;
        if (!el) {
            el = document.createElement('style');
            el.id = 'lbl-div-dynamic';
            document.head.appendChild(el);
        }
        return el;
    }

    private buildAllCss(): string {
        const blocks: string[] = [];
        this.settings.dividers.forEach(d => {
            if (!d.itemName.trim()) return;
            const block = this.buildDividerCss(d);
            if (block) blocks.push(block);
        });
        return blocks.join('\n\n');
    }

    /**
     * Build the CSS for one divider: a rule that reserves space on the matched
     * row, plus a ::before/::after rule that paints the line (and label, if any).
     * Matches the item by name at the vault root (data-path="Name") or nested
     * (data-path ends with "/Name"), mirroring the old name-based findAnchor.
     */
    private buildDividerCss(d: DividerRecord): string {
        const titleClass = d.itemType === 'folder' ? 'nav-folder-title' : 'nav-file-title';
        const scope = '.workspace-leaf-content[data-type="file-explorer"]';
        const name = escapeForCss(d.itemName);
        // Match the item by name at the vault root (exact data-path) OR nested
        // (data-path ending in "/Name"). Each base selector must carry the pseudo
        // suffix individually — a comma list shares no suffix in CSS.
        const bases = [
            `${scope} .${titleClass}[data-path="${name}"]`,
            `${scope} .${titleClass}[data-path$="/${name}"]`,
        ];
        const isAbove = d.position !== 'below';
        const pseudo = isAbove ? '::before' : '::after';
        const hostSel = bases.join(', ');
        const pseudoSel = bases.map(b => b + pseudo).join(', ');
        const labelText = (d.label ?? '').trim();
        const lineColor = d.lineColor || this.settings.dividerColor;
        const labelColor = d.labelColor || this.settings.labelColor;
        const thickness = Math.max(1, this.settings.dividerThickness);
        const fontSize = this.settings.labelFontSize;
        const fontWeight = this.settings.labelBold ? 600 : 400;
        const fontStyle = this.settings.labelItalic ? 'italic' : 'normal';
        const transform = this.settings.labelUppercase ? 'uppercase' : 'none';
        const letterSpacing = this.settings.labelUppercase ? '0.08em' : 'normal';
        const lineCss = `color-mix(in srgb, ${lineColor} 70%, transparent)`;

        // Shared label typography used inside the pseudo-element.
        const labelType =
            `color: ${labelColor}; font-size: ${fontSize}px; font-weight: ${fontWeight}; ` +
            `font-style: ${fontStyle}; text-transform: ${transform}; letter-spacing: ${letterSpacing}; ` +
            `line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

        // PLAIN divider — just a line, no label.
        if (!labelText) {
            const reserve = 13;
            const offset = Math.round(reserve / 2);
            const edge = isAbove ? `top: -${offset}px;` : `bottom: -${offset}px;`;
            const margin = isAbove ? `margin-top: ${reserve}px;` : `margin-bottom: ${reserve}px;`;
            return (
                `${hostSel} { ${margin} position: relative; }\n` +
                `${pseudoSel} {\n` +
                `    content: ""; position: absolute; left: 12px; right: 12px; ${edge}\n` +
                `    height: ${thickness}px; background: ${lineCss}; border-radius: 1px; pointer-events: none;\n` +
                `}`
            );
        }

        // LABELED divider. A single pseudo-element carries the label text; its own
        // border / background renders the line per the chosen style. Keeping it to
        // ONE pseudo means an 'above' and a 'below' divider can coexist on one row.
        const content = `"${escapeForCss(labelText)}"`;
        const reserve = 24;
        const edge = isAbove ? `top: -${reserve - 2}px;` : `bottom: -${reserve - 2}px;`;
        const margin = isAbove ? `margin-top: ${reserve}px;` : `margin-bottom: ${reserve}px;`;
        const style: LabelStyle = d.labelStyle ?? 'above';

        let body: string;
        switch (style) {
            case 'underline':
                body =
                    `display: inline-flex; align-items: flex-end; padding-bottom: 3px; ` +
                    `border-bottom: ${thickness}px solid ${lineColor}; ${labelType}`;
                break;
            case 'chip':
                body =
                    `display: inline-flex; align-items: center; padding: 2px 8px; ` +
                    `background: color-mix(in srgb, ${labelColor} 20%, transparent); ` +
                    `border-radius: 999px; ${labelType} font-weight: 700;`;
                break;
            case 'section':
                body =
                    `display: flex; align-items: center; padding: 2px 10px; ` +
                    `background: color-mix(in srgb, ${labelColor} 10%, transparent); ` +
                    `border-left: 2px solid ${labelColor}; ${labelType} font-weight: 700;`;
                break;
            case 'minimal':
                body =
                    `display: flex; align-items: flex-end; padding-bottom: 3px; ` +
                    `border-bottom: 1px solid ${lineCss}; ${labelType} ` +
                    `text-transform: none; letter-spacing: normal; font-weight: 500; opacity: 0.75;`;
                break;
            case 'tucked':
                body =
                    `display: flex; align-items: flex-end; justify-content: flex-end; padding-bottom: 4px; ` +
                    `border-bottom: 2px solid ${labelColor}; ${labelType}`;
                break;
            case 'gradient':
                body =
                    `display: flex; align-items: center; justify-content: center; ` +
                    `background: linear-gradient(90deg, transparent 0%, ` +
                    `color-mix(in srgb, ${labelColor} 16%, transparent) 50%, transparent 100%); ${labelType}`;
                break;
            case 'centered':
                body =
                    `display: flex; align-items: center; justify-content: center; ` +
                    `background: linear-gradient(${lineCss}, ${lineCss}) center / 100% ${thickness}px no-repeat; ` +
                    `${labelType}`;
                break;
            case 'above':
            default:
                body =
                    `display: flex; align-items: flex-end; padding-bottom: 4px; ` +
                    `border-bottom: ${thickness}px solid ${lineCss}; ${labelType}`;
                break;
        }

        // Nested (in-folder) dividers: gently slide the label text to the right so
        // it reads as belonging to the folder's contents. padding-left shifts only
        // the text — the underline still spans the full width. Scoped to bases[1]
        // ("…/Name"), so root-level dividers are left exactly as-is.
        const nestedIndent = `\n${bases[1]}${pseudo} { padding-left: 14px; }`;

        return (
            `${hostSel} { ${margin} position: relative; }\n` +
            `${pseudoSel} {\n` +
            `    content: ${content}; position: absolute; left: 12px; right: 12px; ${edge}\n` +
            `    height: ${reserve - 4}px; box-sizing: border-box; pointer-events: none;\n` +
            `    ${body}\n` +
            `}` +
            nestedIndent
        );
    }

    /**
     * Remove the divider stylesheet and scrub any legacy injected nodes/attrs from
     * earlier versions. Called on disable and on unload.
     */
    removeDividers() {
        const dyn = document.getElementById('lbl-div-dynamic');
        if (dyn) dyn.remove();

        // Legacy cleanup (<= 1.3.5 DOM-injection + pre-1.3.0 pseudo residue).
        document.querySelectorAll('.lbl-div').forEach(el => el.remove());
        const baseStyles = document.getElementById('lbl-div-styles');
        if (baseStyles) baseStyles.remove();
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
