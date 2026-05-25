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

type LabelStyle = 'above' | 'centered';

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

        // --- Apply dividers when plugin loads ---
        if (this.settings.enabled) {
            this.applyDividers();
        }

        // --- Watch for file explorer changes ---
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                if (this.settings.enabled) {
                    setTimeout(() => this.applyDividers(), 100);
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
        this.removeDividers();
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

    applyDividers() {
        this.removeDividers();

        if (this.settings.dividers.length === 0) {
            return;
        }

        // --- Create CSS horizontal dividers ---
        const cssRules = this.settings.dividers.map(divider => {
            const pseudoElement = divider.position === 'above' ? 'before' : 'after';
            const itemClass = divider.itemType === 'folder' ? 'nav-folder' : 'nav-file';
            const selectorBase = `.${itemClass}-divider-${divider.position}[data-item="${escapeForCss(divider.itemName)}"][data-type="${divider.itemType}"]`;

            if (divider.label) {
                const edge = divider.position === 'above' ? 'top' : 'bottom';
                const marginSide = divider.position === 'above' ? 'margin-top' : 'margin-bottom';
                const transform = this.settings.labelUppercase ? 'uppercase' : 'none';
                const letterSpacing = this.settings.labelUppercase ? '0.08em' : 'normal';
                const fontWeight = this.settings.labelBold ? '600' : '400';
                const fontStyle = this.settings.labelItalic ? 'italic' : 'normal';
                const effectiveLabelColor = divider.labelColor || this.settings.labelColor;
                const effectiveLineColor = divider.lineColor || this.settings.dividerColor;
                const labelStyle: LabelStyle = divider.labelStyle ?? 'above';

                if (labelStyle === 'centered') {
                    // --- Centered: label text overlays the line. ::after = line (full width),
                    //     ::before = text with solid background covering the line behind it. ---
                    const stripeOffset = Math.max(10, this.settings.labelFontSize);
                    const totalSpacing = stripeOffset + this.settings.labelFontSize / 2 + 4;
                    return `
                        /* --- Centered labeled divider for ${divider.itemType} "${divider.itemName}" --- */
                        ${selectorBase} {
                            position: relative;
                            ${marginSide}: ${totalSpacing}px;
                        }

                        ${selectorBase}::after {
                            content: '';
                            position: absolute;
                            ${edge}: -${stripeOffset}px;
                            left: 0;
                            right: 0;
                            width: 100%;
                            height: ${this.settings.dividerThickness}px;
                            background-color: ${effectiveLineColor};
                            border-radius: ${this.settings.dividerThickness / 2}px;
                            opacity: 0.7;
                            pointer-events: none;
                            z-index: 1;
                        }

                        ${selectorBase}::before {
                            content: "${escapeForCss(divider.label)}";
                            position: absolute;
                            ${edge}: -${stripeOffset + this.settings.labelFontSize / 2}px;
                            left: 50%;
                            transform: translateX(-50%);
                            color: ${effectiveLabelColor};
                            font-size: ${this.settings.labelFontSize}px;
                            font-weight: ${fontWeight};
                            font-style: ${fontStyle};
                            text-transform: ${transform};
                            letter-spacing: ${letterSpacing};
                            line-height: 1;
                            padding: 0 8px;
                            background-color: var(--background-secondary, var(--background-primary, #1e1e1e));
                            opacity: 0.95;
                            pointer-events: none;
                            white-space: nowrap;
                            z-index: 2;
                        }
                    `;
                }

                // --- Above-style label layout ---
                // Geometry differs between positions so labels stay "near" their anchor folder:
                //   above: LABEL on the OUTER edge (far from folder), LINE on the INNER edge (close)
                //          → reads top-down as: LABEL, line, FOLDER (label introduces folder)
                //   below: LABEL on the INNER edge (close to folder), LINE on the OUTER edge (far)
                //          → reads top-down as: FOLDER, label, line (label clings to folder, line is the boundary)
                const innerOffset = 6;
                const outerOffset = innerOffset + this.settings.labelFontSize + 8;
                const totalSpacing = outerOffset + 6;
                const labelEdgeOffset = divider.position === 'above' ? outerOffset : innerOffset;
                const lineEdgeOffset = divider.position === 'above' ? innerOffset : outerOffset;

                return `
                    /* --- Labeled divider (above-style) for ${divider.itemType} "${divider.itemName}" ${divider.position} --- */
                    ${selectorBase} {
                        position: relative;
                        ${marginSide}: ${totalSpacing}px;
                    }

                    ${selectorBase}::before {
                        content: "${escapeForCss(divider.label)}";
                        position: absolute;
                        ${edge}: -${labelEdgeOffset}px;
                        left: 0;
                        right: 0;
                        width: 100%;
                        box-sizing: border-box;
                        color: ${effectiveLabelColor};
                        font-size: ${this.settings.labelFontSize}px;
                        font-weight: ${fontWeight};
                        font-style: ${fontStyle};
                        text-transform: ${transform};
                        letter-spacing: ${letterSpacing};
                        line-height: 1.2;
                        padding: 0 6px;
                        opacity: 0.95;
                        pointer-events: none;
                        z-index: 2;
                    }

                    ${selectorBase}::after {
                        content: '';
                        position: absolute;
                        ${edge}: -${lineEdgeOffset}px;
                        left: 0;
                        right: 0;
                        width: 100%;
                        height: ${this.settings.dividerThickness}px;
                        background-color: ${effectiveLineColor};
                        border-radius: ${this.settings.dividerThickness / 2}px;
                        opacity: 0.7;
                        pointer-events: none;
                        z-index: 2;
                    }
                `;
            }

            // --- Plain divider: line-only ---
            //     Pseudo-element gets explicit z-index so adjacent folder/file rows in themes
            //     that paint backgrounds onto siblings can't obscure the line.
            const lineEdgeOffset = 8 + this.settings.dividerThickness;
            return `
                /* --- Plain divider for ${divider.itemType} "${divider.itemName}" ${divider.position} --- */
                ${selectorBase}::${pseudoElement} {
                    content: '';
                    position: absolute;
                    left: 0;
                    right: 0;
                    width: 100%;
                    height: ${this.settings.dividerThickness}px;
                    background-color: ${this.settings.dividerColor};
                    border-radius: ${this.settings.dividerThickness / 2}px;
                    opacity: 0.7;
                    pointer-events: none;
                    z-index: 2;
                    ${divider.position === 'above' ?
                        `top: -${lineEdgeOffset}px;` :
                        `bottom: -${lineEdgeOffset}px;`
                    }
                }

                /* --- Add spacing and position to dividers --- */
                ${selectorBase} {
                    position: relative;
                    ${divider.position === 'above' ? 'margin-top: 16px;' : 'margin-bottom: 16px;'}
                }
            `;
        }).join('\n');

        // --- Add CSS ---
        const styleElement = document.createElement('style');
        styleElement.id = 'files-dividers-styles';
        styleElement.textContent = cssRules;
        document.head.appendChild(styleElement);

        // --- Add classes to file and folder elements ---
        this.addDividerClasses();
    }

    addDividerClasses() {
        const fileExplorer = document.querySelector('.nav-files-container');
        if (!fileExplorer) return;

        // --- Remove existing classes first ---
        document.querySelectorAll('[data-item]').forEach(el => {
            el.removeAttribute('data-item');
            el.removeAttribute('data-type');
            el.classList.remove('nav-folder-divider-above');
            el.classList.remove('nav-folder-divider-below');
            el.classList.remove('nav-file-divider-above');
            el.classList.remove('nav-file-divider-below');
        });

        this.settings.dividers.forEach(divider => {
            // --- Handle folders ---
            if (divider.itemType === 'folder') {
                const folders = fileExplorer.querySelectorAll('.nav-folder');
                folders.forEach(folder => {
                    const titleElement = folder.querySelector('.nav-folder-title');
                    if (titleElement) {
                        const folderName = titleElement.textContent?.trim();
                        if (folderName === divider.itemName) {
                            folder.classList.add(`nav-folder-divider-${divider.position}`);
                            folder.setAttribute('data-item', divider.itemName);
                            folder.setAttribute('data-type', 'folder');
                        }
                    }
                });
            }
            
            // --- Handle files ---
            else if (divider.itemType === 'file') {
                const files = fileExplorer.querySelectorAll('.nav-file');
                files.forEach(file => {
                    const titleElement = file.querySelector('.nav-file-title');
                    if (titleElement) {
                        const fileName = titleElement.textContent?.trim();
                        const fileNameWithoutExt = fileName?.replace(/\.[^/.]+$/, "");
                        const dividerNameWithoutExt = divider.itemName.replace(/\.[^/.]+$/, "");
                        if (fileName === divider.itemName || 
                            fileNameWithoutExt === dividerNameWithoutExt ||
                            fileName === dividerNameWithoutExt ||
                            fileNameWithoutExt === divider.itemName
                        ) {
                            file.classList.add(`nav-file-divider-${divider.position}`);
                            file.setAttribute('data-item', divider.itemName);
                            file.setAttribute('data-type', 'file');
                        }
                    }
                });
            }
        });
    }

    removeDividers() {
        const existingStyles = document.getElementById('files-dividers-styles');
        if (existingStyles) {
            existingStyles.remove();
        }
        
        // --- Remove classes and attributes ---
        document.querySelectorAll('[data-item]').forEach(el => {
            el.removeAttribute('data-item');
            el.removeAttribute('data-type');
            el.removeClass('nav-folder-divider-above');
            el.removeClass('nav-folder-divider-below');
            el.removeClass('nav-file-divider-above');
            el.removeClass('nav-file-divider-below');
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
                    setting.addDropdown(dropdown =>
                        dropdown
                            .addOption('above', 'Above')
                            .addOption('centered', 'Centered ─x─')
                            .setValue(divider.labelStyle ?? 'above')
                            .onChange(async (value) => {
                                this.plugin.updateDividerStyle(divider.itemName, divider.itemType, divider.position, value as LabelStyle);
                                this.display();
                            })
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
        styleRow.style.display = 'flex';
        styleRow.style.gap = '16px';
        styleRow.style.marginBottom = '14px';

        const makeRadio = (value: LabelStyle, labelText: string, descText: string) => {
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
            const titleEl = labelWrap.createEl('div', { text: labelText });
            titleEl.style.fontSize = '13px';
            const descEl = labelWrap.createEl('div', { text: descText });
            descEl.style.fontSize = '11px';
            descEl.style.opacity = '0.7';
        };

        makeRadio('above', 'Above', 'Text sits above the line');
        makeRadio('centered', 'Centered', '─── TEXT ─── (line through label)');

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