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

interface FilesDividersSettings {
    dividers: Array<{
        itemName: string;
        itemType: 'file' | 'folder';
        position: 'above' | 'below';
        style: 'line' | 'space' | 'gradient';
        label?: string;
    }>;
    dividerColor: string;
    dividerThickness: number;
    labelColor: string;
    labelFontSize: number;
    labelUppercase: boolean;
    enabled: boolean;
}

const DEFAULT_SETTINGS: FilesDividersSettings = {
    dividers: [],
    dividerColor: '#484848',
    dividerThickness: 1,
    labelColor: '#888888',
    labelFontSize: 11,
    labelUppercase: true,
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
                    
                    // --- Add/Remove divider above ---
                    if (existingAbove) {
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

                    // --- Add/Remove divider below ---
                    if (existingBelow) {
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

    addDividerToItem(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below', label?: string) {
        const exists = this.settings.dividers.find(
            d => d.itemName === itemName && d.itemType === itemType && d.position === position
        );

        if (exists) {
            new Notice(`Divider already exists ${position} ${itemType} "${itemName}"`);
            return;
        }

        const divider: FilesDividersSettings['dividers'][number] = {
            itemName,
            itemType,
            position,
            style: 'line'
        };
        if (label && label.trim()) {
            divider.label = label.trim();
        }
        this.settings.dividers.push(divider);

        this.saveSettings();
        const labelPart = divider.label ? ` ("${divider.label}")` : '';
        new Notice(`Added divider${labelPart} ${position} ${itemType} "${itemName}"`);
    }

    promptAndAddLabeledDivider(itemName: string, itemType: 'file' | 'folder', position: 'above' | 'below') {
        new LabelInputModal(this.app, '', (label) => {
            if (label === null) return;
            this.addDividerToItem(itemName, itemType, position, label);
        }).open();
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
                // --- Labeled divider: ::before holds the label text, ::after holds the line.
                //     Both pseudo-elements are absolutely positioned outside the folder so they
                //     stack reliably (label further out, line nearer the folder edge).         ---
                const edge = divider.position === 'above' ? 'top' : 'bottom';
                const marginSide = divider.position === 'above' ? 'margin-top' : 'margin-bottom';
                const lineOffset = 6;
                const labelOffset = lineOffset + this.settings.labelFontSize + 8;
                const totalSpacing = labelOffset + 6;
                const transform = this.settings.labelUppercase ? 'uppercase' : 'none';
                const letterSpacing = this.settings.labelUppercase ? '0.08em' : 'normal';

                return `
                    /* --- Labeled divider for ${divider.itemType} "${divider.itemName}" --- */
                    ${selectorBase} {
                        position: relative;
                        ${marginSide}: ${totalSpacing}px;
                    }

                    ${selectorBase}::before {
                        content: "${escapeForCss(divider.label)}";
                        position: absolute;
                        ${edge}: -${labelOffset}px;
                        left: 0;
                        right: 0;
                        width: 100%;
                        box-sizing: border-box;
                        color: ${this.settings.labelColor};
                        font-size: ${this.settings.labelFontSize}px;
                        font-weight: 600;
                        text-transform: ${transform};
                        letter-spacing: ${letterSpacing};
                        line-height: 1.2;
                        padding: 0 6px;
                        opacity: 0.95;
                        pointer-events: none;
                    }

                    ${selectorBase}::after {
                        content: '';
                        position: absolute;
                        ${edge}: -${lineOffset}px;
                        left: 0;
                        right: 0;
                        width: 100%;
                        height: ${this.settings.dividerThickness}px;
                        background-color: ${this.settings.dividerColor};
                        border-radius: ${this.settings.dividerThickness / 2}px;
                        opacity: 0.7;
                        pointer-events: none;
                    }
                `;
            }

            // --- Plain divider: original line-only behavior ---
            return `
                /* --- Divider styles for files and folders --- */
                ${selectorBase}::${pseudoElement} {
                    content: '';
                    position: absolute;
                    left: 0;
                    right: 0;
                    width: 100%;
                    height: ${this.settings.dividerThickness}px;
                    background-color: ${this.settings.dividerColor};
                    border-radius: ${this.settings.dividerThickness / 2}px;
                    opacity: 0.6;
                    ${divider.position === 'above' ?
                        `top: -${8 + this.settings.dividerThickness}px;` :
                        `bottom: -${8 + this.settings.dividerThickness}px;`
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

            const renderDividerRow = (divider: FilesDividersSettings['dividers'][number], emoji: string) => {
                const labelDisplay = divider.label ? `"${divider.label}"` : '(no label)';
                const setting = new Setting(containerEl)
                    .setName(`${emoji} ${divider.itemName}`)
                    .setDesc(`Divider ${divider.position} — ${labelDisplay}`);

                setting.addText(text =>
                    text
                        .setPlaceholder('Section label (blank for plain line)')
                        .setValue(divider.label ?? '')
                        .onChange(async (value) => {
                            this.plugin.updateDividerLabel(divider.itemName, divider.itemType, divider.position, value);
                        })
                );

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
 * Modal that prompts the user for a label string when creating a labeled divider.
 * Returns the entered label (or null on cancel) via callback.
 */
class LabelInputModal extends Modal {
    private initialValue: string;
    private callback: (label: string | null) => void;
    private settled: boolean = false;

    constructor(app: App, initialValue: string, callback: (label: string | null) => void) {
        super(app);
        this.initialValue = initialValue;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Section label' });
        contentEl.createEl('p', {
            text: 'Enter the text to display above the divider line. Leave blank to cancel.',
            cls: 'setting-item-description'
        });

        const input = contentEl.createEl('input', { type: 'text' });
        input.value = this.initialValue;
        input.placeholder = 'e.g. PROJECTS';
        input.style.width = '100%';
        input.style.marginBottom = '12px';
        input.focus();
        input.select();

        const buttonRow = contentEl.createDiv();
        buttonRow.style.display = 'flex';
        buttonRow.style.justifyContent = 'flex-end';
        buttonRow.style.gap = '8px';

        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        const submitBtn = buttonRow.createEl('button', { text: 'Add divider', cls: 'mod-cta' });

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
            this.callback(null);
            this.settled = true;
        }
        this.contentEl.empty();
    }

    private settle(value: string | null) {
        if (this.settled) return;
        this.settled = true;
        this.callback(value);
    }
}