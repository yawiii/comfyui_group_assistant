/**
 * @file UI模块
 * @description 负责创建、管理和更新插件的所有UI元素。
 */

import { app } from "../../../scripts/app.js";
import { state, updateState, addStateListener } from "./utils/state.js";
import {
    enableHijack,
    disableHijack,
    migrateExistingRelationships,
    forceRecalculateRelationships,
    unlinkSelectedItems,
    rebuildAllGroupRelationships,
    recalculateSelectedItemsRelationships
} from "./utils/groupRelations.js";
import { logger } from "./utils/logger.js";
import { i18n } from "./utils/i18n.js";

// 全局UI容器，以便在语言更改时重建
let splitButtonContainer = null;

/**
 * 更新按钮状态
 * 根据hijackEnabled状态更新按钮的文本和样式
 */
export function updateToggleButtonState() {
    if (state.toggleButton) {
        const splitButton = state.toggleButton.parentElement;
        if (splitButton) {
            if (state.hijackEnabled) {
                splitButton.classList.add('enabled');
                splitButton.classList.remove('disabled');
                state.toggleButton.title = "点击关闭阿组小助手判定劫持";
            } else {
                splitButton.classList.add('disabled');
                splitButton.classList.remove('enabled');
                state.toggleButton.title = "点击开启阿组小助手判定劫持";
            }
        }
    }
}

/**
 * 绘制组高亮外描边
 * 在拖动元素到组上时显示高亮效果
 */
export function drawGroupHighlight(group, ctx, color) {
    // 安全检查：确保组对象有效且未被删除
    if (!group || group._isDeleted) return;

    // 安全检查：确保所有必要的属性都存在
    if (!group._bounding || !group._pos || !group._size) return;

    try {
        const [x, y] = group._pos;
        const [width, height] = group._size;

        // 安全检查：确保位置和尺寸是有效的数字
        if (typeof x !== 'number' || typeof y !== 'number' ||
            typeof width !== 'number' || typeof height !== 'number' ||
            isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
            return;
        }

        const font_size = group.font_size || 24;

        // 安全检查：确保canvas和转换函数可用
        if (!app.canvas || !app.canvas.convertOffsetToCanvas) return;

        const canvasPoint = app.canvas.convertOffsetToCanvas([x, y]);
        if (!canvasPoint) return;

        const [screenX, screenY] = canvasPoint;
        const scale = app.canvas.ds.scale;
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;

        ctx.save();
        ctx.globalAlpha = 0.55 * app.canvas.editor_alpha;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;

        ctx.beginPath();
        ctx.rect(screenX + 0.5, screenY + 0.5, scaledWidth, font_size * 1.4 * scale);
        ctx.fill();

        ctx.beginPath();
        ctx.rect(screenX + 0.5, screenY + 0.5, scaledWidth, scaledHeight);
        ctx.fill();

        ctx.globalAlpha = app.canvas.editor_alpha;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    } catch (error) {
        logger.error("绘制组高亮时出错:", error);
    }
}

/**
 * 创建或重建UI的主要函数
 */
function buildFullUI() {
    // 如果容器存在，清空它
    if (splitButtonContainer) {
        splitButtonContainer.innerHTML = '';
    } else {
        // 如果容器不存在，创建它
        splitButtonContainer = document.createElement('div');
        splitButtonContainer.className = 'group-assistant-ui-container';
        // 将容器插入到DOM中
        app.menu?.actionsGroup.element.after(splitButtonContainer);
    }

    // 创建SplitButton容器
    const splitButton = document.createElement('div');
    splitButton.className = 'p-splitbutton';

    // 创建主按钮
    const mainButton = document.createElement('button');
    mainButton.className = 'p-splitbutton-defaultbutton comfyui-button';
    const supergroupIcon = document.createElement('span');
    supergroupIcon.className = 'p-splitbutton-group-assistant-icon';
    mainButton.appendChild(supergroupIcon);
    mainButton.onclick = () => {
        updateState({ hijackEnabled: !state.hijackEnabled });
        if (state.hijackEnabled) {
            enableHijack();
        } else {
            disableHijack();
        }
    };

    // 创建下拉按钮
    const menuButton = document.createElement('button');
    menuButton.className = 'p-splitbutton-menubutton comfyui-button';
    const dropdownIcon = document.createElement('span');
    dropdownIcon.className = 'p-icon p-select-dropdown-icon';
    menuButton.appendChild(dropdownIcon);

    // 创建下拉菜单
    const menu = document.createElement('div');
    menu.className = 'p-splitbutton-menu no-transition';
    menu.style.display = 'none'; // 初始时隐藏菜单

    // --- 菜单显示/隐藏逻辑 ---
    const toggleMenu = () => menu.classList.contains('p-splitbutton-menu-active') ? hideMenu() : showMenu();
    const showMenu = () => {
        menu.style.display = 'block'; // 显示菜单
        requestAnimationFrame(() => {
            menu.classList.add('p-splitbutton-menu-active');
        });
        setTimeout(() => document.addEventListener('click', hideMenu), 0);
    };
    const hideMenu = () => {
        menu.classList.remove('p-splitbutton-menu-active');
        const onTransitionEnd = () => {
            menu.style.display = 'none';
            menu.removeEventListener('transitionend', onTransitionEnd);
        };
        menu.addEventListener('transitionend', onTransitionEnd);
        document.removeEventListener('click', hideMenu);
    };
    menuButton.onclick = (e) => {
        e.stopPropagation();
        toggleMenu();
    };

    // --- 菜单内容 ---
    createMenuContent(menu, hideMenu);

    // --- 组装 ---
    splitButton.appendChild(mainButton);
    splitButton.appendChild(menuButton);
    splitButton.appendChild(menu);

    // 将新创建的UI添加到容器中
    splitButtonContainer.appendChild(splitButton);

    // 更新状态
    updateState({ toggleButton: mainButton });
    updateToggleButtonState();

    setTimeout(() => {
        menu.classList.remove('no-transition');
    }, 50);
}


/**
 * 创建阿组小助手切换按钮
 * 创建UI按钮并添加事件处理
 */
export async function createUI() {
    // 导入样式文件 (只执行一次)
    if (!document.querySelector('link[href*="group_assistant/style.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.type = 'text/css';
        const baseURL = new URL(import.meta.url);
        const cssPath = new URL('./style.css', baseURL).href.replace('ui.js', 'style.css'); // Robust path
        link.href = cssPath;
        document.head.appendChild(link);
    }

    // 首次构建UI
    buildFullUI();

    // 监听语言变化，以便在语言切换时重建UI
    i18n.addChangeListener(buildFullUI);

    // 添加状态监听 (这些监听器只需要添加一次)
    addStateListener('hijackEnabled', updateToggleButtonState);

    // 如果启用了自动开启，则在初始化时执行重新计算组关系
    if (state.autoEnable) {
        logger.debug(i18n.t("log_plugin_started"));

        // 使用更安全的方式检测ComfyUI已完全加载
        const waitForGraphReady = () => {
            // 检查图形是否已加载完成
            if (app.graph && app.graph._nodes && app.graph._groups) {
                logger.debug("ComfyUI图形已加载，准备初始化组关系");

                // 延迟初始化，确保UI完全加载
                setTimeout(() => {
                    try {
                        // 临时关闭自动边界更新，减少初始计算量
                        const originalAutoBoundary = state.autoBoundaryEnabled;
                        updateState({ autoBoundaryEnabled: false });

                        // 执行初始化
                        enableHijack();

                        // 恢复原来的设置
                        setTimeout(() => {
                            updateState({ autoBoundaryEnabled: originalAutoBoundary });
                        }, 500);
                    } catch (error) {
                        logger.error("初始化时出错:", error);
                    }
                }, 2000);
            } else {
                // 继续等待
                setTimeout(waitForGraphReady, 500);
            }
        };

        // 延迟开始检测，给ComfyUI更多启动时间
        setTimeout(waitForGraphReady, 1500);
    }
}

/**
 * 创建下拉菜单的全部内容
 * @param {HTMLElement} menu - 菜单的根元素
 * @param {Function} hideMenu - 关闭菜单的回调函数
 */
function createMenuContent(menu, hideMenu) {
    // 1. 信息行
    const infoRow = document.createElement('div');
    infoRow.className = 'p-splitbutton-menuitem info-row';
    infoRow.innerHTML = `
        <div class="plugin-title-container">
            <span class="p-splitbutton-group-assistant-icon"></span>
            <span class="plugin-name">${i18n.t("plugin_name")}</span>
            <span class="plugin-version">${i18n.t("plugin_version", window.GroupAssistant_Version || '1.0.x')}</span>
        </div>
        <div class="info-row-separator"></div>
        <div class="badges-container">
            <a href="https://github.com/yawiii/comfyui_group_assistant" target="_blank">
                <img alt="GitHub" src="https://img.shields.io/badge/-Yawiii-blue?style=flat&logo=github&logoColor=black&labelColor=%23E1E1E2&color=%2307A3D7">
            </a>
            <a href="https://space.bilibili.com/520680644" target="_blank">
                <img alt="Bilibili" src="https://img.shields.io/badge/-%E6%8F%92%E4%BB%B6%E4%BB%8B%E7%BB%8D-blue?logo=bilibili&logoColor=%23E1E1E&labelColor=%23E1E1E2&color=%2307A3D7">
            </a>
        </div>
    `;
    menu.appendChild(infoRow);

    // 2. 菜单项
    const menuItems = [
        {
            label: i18n.t("cmd_recalculate_all"),
            iconClass: 'p-recalculate-icon',
            action: () => {
                rebuildAllGroupRelationships();
                hideMenu();
            }
        },
        {
            label: i18n.t("cmd_recalculate_selected"),
            iconClass: 'p-recalculate-icon',
            action: () => {
                recalculateSelectedItemsRelationships();
                hideMenu();
            }
        },
        {
            label: i18n.t("cmd_unlink"),
            iconClass: 'p-unlink-icon',
            action: () => {
                unlinkSelectedItems();
                hideMenu();
            }
        }
    ];

    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'p-splitbutton-menuitem';
        menuItem.innerHTML = `<span class="p-menuitem-icon ${item.iconClass}"></span><span>${item.label}</span>`;
        menuItem.onclick = item.action;
        menu.appendChild(menuItem);
    });

    // 3. 分割线
    const menuSeparator = document.createElement('div');
    menuSeparator.className = 'info-row-separator';
    menu.appendChild(menuSeparator);

    // 4. 自动开启开关
    const autoEnableControl = createAutoEnableControl();
    menu.appendChild(autoEnableControl);

    // 5. 自动边界更新开关
    const autoBoundaryControl = createAutoBoundaryControl();
    menu.appendChild(autoBoundaryControl);

    // 6. 灵敏度滑块
    const sensitivityControl = createSensitivityControl();
    menu.appendChild(sensitivityControl);
}

/**
 * 创建自动开启开关
 * @returns {HTMLElement}
 */
function createAutoEnableControl() {
    const autoEnableMenuItem = document.createElement('div');
    autoEnableMenuItem.className = 'p-splitbutton-menuitem';

    const icon = document.createElement('span');
    icon.className = 'p-menuitem-icon p-auto-power-icon';

    const label = document.createElement('span');
    label.textContent = i18n.t("auto_enable");

    const toggleSwitch = document.createElement('div');
    toggleSwitch.className = 'group-assistant-toggleswitch';
    toggleSwitch.innerHTML = `<span class="group-assistant-toggleswitch-slider"></span>`;

    // 使用状态管理系统
    const updateSwitchUI = (enabled) => {
        if (enabled) {
            toggleSwitch.classList.add('group-assistant-toggleswitch-checked');
        } else {
            toggleSwitch.classList.remove('group-assistant-toggleswitch-checked');
        }
    };

    // 添加状态监听
    addStateListener('autoEnable', updateSwitchUI);
    updateSwitchUI(state.autoEnable);

    autoEnableMenuItem.onclick = (e) => {
        e.stopPropagation();
        const newAutoEnableState = !state.autoEnable;
        updateState({
            autoEnable: newAutoEnableState,
            hijackEnabled: newAutoEnableState
        });

        // 根据新状态直接调用功能开关
        if (newAutoEnableState) {
            enableHijack();
        } else {
            disableHijack();
        }
    };

    autoEnableMenuItem.append(icon, label, toggleSwitch);
    return autoEnableMenuItem;
}

/**
 * 创建自动边界更新开关
 * @returns {HTMLElement}
 */
function createAutoBoundaryControl() {
    const autoBoundaryMenuItem = document.createElement('div');
    autoBoundaryMenuItem.className = 'p-splitbutton-menuitem';

    const icon = document.createElement('span');
    icon.className = 'p-menuitem-icon p-auto-boundary-icon';

    const label = document.createElement('span');
    label.textContent = i18n.t("auto_boundary");

    const toggleSwitch = document.createElement('div');
    toggleSwitch.className = 'group-assistant-toggleswitch';
    toggleSwitch.innerHTML = `<span class="group-assistant-toggleswitch-slider"></span>`;

    // 使用状态管理系统
    const updateSwitchUI = (enabled) => {
        if (enabled) {
            toggleSwitch.classList.add('group-assistant-toggleswitch-checked');
        } else {
            toggleSwitch.classList.remove('group-assistant-toggleswitch-checked');
        }
    };

    // 添加状态监听
    addStateListener('autoBoundaryEnabled', updateSwitchUI);
    updateSwitchUI(state.autoBoundaryEnabled);

    autoBoundaryMenuItem.onclick = (e) => {
        e.stopPropagation();
        updateState({ autoBoundaryEnabled: !state.autoBoundaryEnabled });
    };

    autoBoundaryMenuItem.append(icon, label, toggleSwitch);
    return autoBoundaryMenuItem;
}

/**
 * 创建灵敏度调节器
 * @returns {HTMLElement}
 */
function createSensitivityControl() {
    const sensitivityMenuItem = document.createElement('div');
    sensitivityMenuItem.className = 'p-splitbutton-menuitem sensitivity-control';
    sensitivityMenuItem.onclick = (e) => e.stopPropagation();

    const icon = document.createElement('span');
    icon.className = 'p-menuitem-icon p-sensitivity-icon';

    const label = document.createElement('span');
    label.className = 'sensitivity-label-text';
    label.textContent = i18n.t("sensitivity");

    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'p-slider-container';
    const slider = document.createElement('div');
    slider.className = 'p-slider';

    const updateSliderUI = (sensitivity) => {
        const percent = sensitivity * 100;
        slider.innerHTML = `
            <span class="p-slider-range" style="width: ${percent}%"></span>
            <span class="p-slider-handle" style="left: ${percent}%"></span>
        `;
    };
    updateSliderUI(state.overlapSensitivity);

    sliderContainer.appendChild(slider);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'sensitivity-value-container';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sensitivity-value-input';

    // 使用状态管理系统更新输入框
    const updateInputUI = (sensitivity) => {
        input.value = Math.round(sensitivity * 100);
    };
    updateInputUI(state.overlapSensitivity);

    const percentSign = document.createElement('span');
    percentSign.textContent = '%';
    valueContainer.appendChild(input);
    valueContainer.appendChild(percentSign);

    // 添加状态监听
    addStateListener('overlapSensitivity', (sensitivity) => {
        updateSliderUI(sensitivity);
        updateInputUI(sensitivity);
    });

    const sliderHandle = slider.querySelector('.p-slider-handle');

    slider.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target === sliderHandle) return;
        const rect = slider.getBoundingClientRect();
        if (rect.width > 0) {
            const sensitivity = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            updateState({ overlapSensitivity: sensitivity });
        }
    });

    sliderHandle.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault(); // 防止文本选择

        // 获取初始位置
        const sliderRect = slider.getBoundingClientRect();
        const sliderWidth = sliderRect.width;
        if (sliderWidth === 0) return;

        // 计算初始偏移量，使拖动更精确
        const handleRect = sliderHandle.getBoundingClientRect();
        const offsetX = e.clientX - handleRect.left;

        const onDrag = (moveEvent) => {
            moveEvent.preventDefault(); // 防止在拖动过程中选择文本
            const rect = slider.getBoundingClientRect();
            // 考虑初始偏移量，使拖动更加精确
            const sensitivity = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left - offsetX + handleRect.width / 2) / rect.width));
            updateState({ overlapSensitivity: sensitivity });
        };

        const onDragEnd = () => {
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', onDragEnd);
            document.body.style.cursor = ''; // 恢复默认光标
        };

        // 设置拖动时的光标样式
        document.body.style.cursor = 'grabbing';
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDragEnd);
    });

    input.addEventListener('change', () => {
        const value = Math.max(0, Math.min(100, parseInt(input.value, 10) || 0));
        input.value = value;
        updateState({ overlapSensitivity: value / 100 });
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
    });

    sensitivityMenuItem.append(icon, label, sliderContainer, valueContainer);
    return sensitivityMenuItem;
} 