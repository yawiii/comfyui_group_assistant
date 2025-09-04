/**
 * @file 主入口、插件注册与事件监听
 * @description 注册ComfyUI扩展，设置所有事件监听器，并将事件分派到各个模块。
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { GroupAssistantConfig } from "./utils/config.js";
import { state, updateState } from "./utils/state.js";
import {
    enableHijack,
    disableHijack,
    unlinkSelectedItems,
    addSelectedItemsToGroup,
    determineElementsForNewGroup,
    getCurrentSelection,
    forceUpdateAllRelationships,
    migrateExistingRelationships,
    recalculateSelectedItemsRelationships,
    handleOrphanedItems,
    rebuildAllGroupRelationships,
    hijackOnGroup,
    updateDraggedNodeRelationships,
    updateDraggedGroupRelationships,
    updateResizedGroupRelationships
} from "./utils/groupRelations.js";
import { createUI, drawGroupHighlight } from "./ui.js";
import { updateGroupBoundary, checkElementOverlap } from "./utils/boundary.js";
import { logger } from "./utils/logger.js";
import { i18n } from "./utils/i18n.js";

// 添加监听组标题编辑完成的事件
function setupTitleEditListener() {
    // 为重建关系函数添加防抖
    let rebuildDebounceTimer = null;
    const debouncedRebuild = () => {
        clearTimeout(rebuildDebounceTimer);
        rebuildDebounceTimer = setTimeout(() => {
            logger.debug(i18n.t("log_title_edit_debounced"));
            rebuildAllGroupRelationships();
        }, 150); // 150ms的延迟可以有效合并短时间内的多次触发
    };

    // 监听 titleEditorTarget 变为 null 的情况，这表示标题编辑已完成
    const titleEditObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            // 检查是否是标题编辑器相关的元素被移除
            if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
                for (const node of mutation.removedNodes) {
                    if (node.classList &&
                        (node.classList.contains('group-title-editor') ||
                            node.classList.contains('node-title-editor'))) {
                        // 触发防抖重建，而不是直接调用
                        debouncedRebuild();
                        return; // 找到一个匹配项就足够了
                    }
                }
            }
        }
    });

    // 开始观察 document.body 的变化，特别是子元素的添加和删除
    titleEditObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 返回一个清理函数
    return () => {
        titleEditObserver.disconnect();
    };
}

// ================ 事件监听器 ================

/**
 * 设置Shift键状态监听
 */
function setupShiftKeyListeners() {
    // 处理按键按下
    const onKeyDown = (e) => {
        if (e.key === 'Shift') {
            updateState({ shiftKeyPressed: true });
        }
        // if (e.key === 'Control' || e.key === 'Meta') {
        //     updateState({ ctrlKeyPressed: true });
        // }
    };

    // 处理按键释放
    const onKeyUp = (e) => {
        if (e.key === 'Shift') {
            updateState({ shiftKeyPressed: false });
        }
        // if (e.key === 'Control' || e.key === 'Meta') {
        //     updateState({ ctrlKeyPressed: false });
        // }
    };

    // 处理窗口失去焦点时重置状态
    const onBlur = () => {
        updateState({ shiftKeyPressed: false });
        // updateState({ ctrlKeyPressed: false });
    };

    // 添加事件监听
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // 返回清理函数
    return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
    };
}

/**
 * 设置节点和组的选中事件监听
 * @param {LGraphCanvas} canvas 
 */
function setupSelectionListeners(canvas) {
    const originalSelectNode = canvas.selectNode;
    canvas.selectNode = function (node, add) {
        originalSelectNode.apply(this, arguments);
        if (node) {
            updateState({
                currentSelectedNodes: add ? [...state.currentSelectedNodes, node] : [node]
            });
        }
    };

    const originalDeselectNode = canvas.deselectNode;
    canvas.deselectNode = function (node) {
        originalDeselectNode.apply(this, arguments);
        if (node) {
            updateState({
                currentSelectedNodes: state.currentSelectedNodes.filter(n => n !== node)
            });
        }
    };

    const originalDeselectAllNodes = canvas.deselectAllNodes;
    canvas.deselectAllNodes = function () {
        originalDeselectAllNodes.apply(this, arguments);
        updateState({ currentSelectedNodes: [] });
    };

    // 增强组选择功能
    const originalSelectGroup = canvas.selectGroup;
    canvas.selectGroup = function (group, add) {
        try {
            // 调用原始方法
            if (originalSelectGroup && typeof originalSelectGroup === 'function') {
                originalSelectGroup.apply(this, arguments);
            }

            // 更新我们自己跟踪的状态
            if (group) {
                if (add) {
                    // 添加模式 - 确保不重复添加
                    if (!state.currentSelectedGroups.includes(group)) {
                        updateState({
                            currentSelectedGroups: [...state.currentSelectedGroups, group]
                        });
                    }
                } else {
                    // 替换模式
                    updateState({
                        currentSelectedGroups: [group]
                    });
                }

                // 确保LiteGraph内部状态也正确
                if (!this.selected_groups) {
                    this.selected_groups = [];
                }
                if (add) {
                    if (!this.selected_groups.includes(group)) {
                        this.selected_groups.push(group);
                    }
                } else {
                    this.selected_groups = [group];
                }

                // 设置组的选中标记
                if (group.flags) {
                    group.flags.selected = true;
                } else {
                    group.flags = { selected: true };
                }
            }

            // 打印当前选中的组
            logger.debug(`选中组更新: ${state.currentSelectedGroups.length} 个组`);
        } catch (error) {
            logger.error("选中组时出错:", error);
            // 确保状态更新即使原始方法失败
            if (group) {
                updateState({
                    currentSelectedGroups: add ? [...state.currentSelectedGroups, group] : [group]
                });
            }
        }
    };

    const originalDeselectGroup = canvas.deselectGroup;
    canvas.deselectGroup = function (group) {
        try {
            // 调用原始方法
            originalDeselectGroup.apply(this, arguments);

            // 更新我们自己跟踪的状态
            if (group) {
                updateState({
                    currentSelectedGroups: state.currentSelectedGroups.filter(g => g !== group)
                });

                // 确保LiteGraph内部状态也正确
                if (this.selected_groups) {
                    this.selected_groups = this.selected_groups.filter(g => g !== group);
                }

                // 移除组的选中标记
                if (group.flags) {
                    group.flags.selected = false;
                }
            }
        } catch (error) {
            logger.error("取消选中组时出错:", error);
            // 确保状态更新即使原始方法失败
            if (group) {
                updateState({
                    currentSelectedGroups: state.currentSelectedGroups.filter(g => g !== group)
                });
            }
        }
    };

    const originalDeselectAllGroups = canvas.deselectAllGroups;
    canvas.deselectAllGroups = function () {
        try {
            // 调用原始方法
            originalDeselectAllGroups.apply(this, arguments);

            // 清除所有组的选中标记
            if (app.graph && app.graph._groups) {
                for (const group of app.graph._groups) {
                    if (group && group.flags) {
                        group.flags.selected = false;
                    }
                }
            }

            // 更新我们自己跟踪的状态
            updateState({ currentSelectedGroups: [] });

            // 确保LiteGraph内部状态也正确
            this.selected_groups = [];
        } catch (error) {
            logger.error("取消选中所有组时出错:", error);
            // 确保状态更新即使原始方法失败
            updateState({ currentSelectedGroups: [] });
        }
    };

    // 监听鼠标点击事件，增强多组选择
    const originalMouseDown = canvas.onMouseDown;
    canvas.onMouseDown = function (e) {
        // 安全检查：确保originalMouseDown存在
        let result;
        try {
            // 调用原始方法（如果存在）
            if (originalMouseDown && typeof originalMouseDown === 'function') {
                result = originalMouseDown.apply(this, arguments);
            }
        } catch (error) {
            logger.error("调用原始onMouseDown方法时出错:", error);
        }

        try {
            // 如果按住Ctrl/Cmd键，支持多选组
            if (e && (e.ctrlKey || e.metaKey) && this.graph) {
                const pos = this.convertEventToCanvas ? this.convertEventToCanvas(e) : null;
                if (!pos) return result;

                const group = this.getGroupOnPos ? this.getGroupOnPos(pos[0], pos[1]) : null;

                if (group) {
                    // 如果找到组，切换其选中状态
                    const isSelected = state.currentSelectedGroups.includes(group);
                    if (isSelected) {
                        if (this.deselectGroup) {
                            this.deselectGroup(group);
                        }
                    } else {
                        if (this.selectGroup) {
                            this.selectGroup(group, true); // true表示添加到现有选择
                        }
                    }

                    // 防止事件传播，避免取消其他选择
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        } catch (error) {
            logger.error("处理组多选时出错:", error);
        }

        return result;
    };

    // 返回一个清理函数，用于恢复原始方法
    return () => {
        canvas.selectNode = originalSelectNode;
        canvas.deselectNode = originalDeselectNode;
        canvas.deselectAllNodes = originalDeselectAllNodes;
        canvas.selectGroup = originalSelectGroup;
        canvas.deselectGroup = originalDeselectGroup;
        canvas.deselectAllGroups = originalDeselectAllGroups;
        canvas.onMouseDown = originalMouseDown;
    };
}


/**
 * 添加拖动相关事件监听
 * @param {LGraphCanvas} canvas
 */
function setupDragListeners(canvas) {
    const originalMouseMove = canvas.onMouseMove;
    canvas.onMouseMove = function (e) {
        originalMouseMove?.call(this, e);
        if (!state.hijackEnabled) return;

        if (this.node_dragged?.group) {
            updateGroupBoundary(this.node_dragged.group, true);
        }
        if (this.selected_nodes) {
            const groupsToUpdate = new Set();
            Object.values(this.selected_nodes).forEach(node => {
                if (node.group) groupsToUpdate.add(node.group);
            });
            groupsToUpdate.forEach(group => updateGroupBoundary(group, true));
        }
        if (this.selected_group?.group) {
            updateGroupBoundary(this.selected_group.group, true);
        }
    };

    const originalMouseUp = canvas.onMouseUp;
    canvas.onMouseUp = function (e) {
        // 记录拖动前的状态
        const wasDragging = this.dragging_canvas || this.node_dragged || this.selected_group?.is_dragged || this.resizing_group;
        const draggedNode = this.node_dragged;
        const draggedGroup = this.selected_group && this.selected_group.is_dragged ? this.selected_group : null;
        const resizingGroup = this.resizing_group;

        // 记录当前选中的节点和组
        let currentSelectedNodes = [];
        let currentSelectedGroups = [];

        if (this.selected_nodes) {
            if (Array.isArray(this.selected_nodes)) {
                currentSelectedNodes = [...this.selected_nodes];
            } else {
                currentSelectedNodes = Object.values(this.selected_nodes);
            }
        }

        if (this.selected_groups) {
            currentSelectedGroups = [...this.selected_groups];
        }

        if (this.selected_group && !currentSelectedGroups.includes(this.selected_group)) {
            currentSelectedGroups.push(this.selected_group);
        }

        // 执行原始mouseUp逻辑
        originalMouseUp.apply(this, arguments);

        // 如果是处于组助手模式且有拖动行为
        if (state.hijackEnabled && wasDragging) {
            // 立即执行轻量级更新，仅针对受影响的元素
            if (draggedNode) {
                updateDraggedNodeRelationships(draggedNode);

                // 确保拖动的节点仍在选中状态
                if (!currentSelectedNodes.includes(draggedNode)) {
                    currentSelectedNodes.push(draggedNode);
                }
            }

            if (draggedGroup) {
                updateDraggedGroupRelationships(draggedGroup);

                // 确保拖动的组仍在选中状态
                if (!currentSelectedGroups.includes(draggedGroup)) {
                    currentSelectedGroups.push(draggedGroup);
                }
            }

            if (resizingGroup) {
                updateResizedGroupRelationships(resizingGroup);

                // 确保调整大小的组仍在选中状态
                if (!currentSelectedGroups.includes(resizingGroup)) {
                    currentSelectedGroups.push(resizingGroup);
                }
            }

            // 更新全局选中状态
            updateState({
                currentSelectedNodes,
                currentSelectedGroups
            });

            // 确保Canvas上的选中状态与我们的状态同步
            if (draggedNode && !this.selected_nodes?.includes?.(draggedNode)) {
                try {
                    if (typeof this.selectNode === 'function') {
                        this.selectNode(draggedNode, true);
                    }
                } catch (error) {
                    logger.error("选中拖动节点时出错:", error);
                }
            }

            if (draggedGroup && !this.selected_groups?.includes?.(draggedGroup)) {
                try {
                    if (typeof this.selectGroup === 'function') {
                        this.selectGroup(draggedGroup, true);
                    }
                } catch (error) {
                    logger.error("选中拖动组时出错:", error);
                }
            }

            if (resizingGroup && !this.selected_groups?.includes?.(resizingGroup)) {
                try {
                    if (typeof this.selectGroup === 'function') {
                        this.selectGroup(resizingGroup, true);
                    }
                } catch (error) {
                    logger.error("选中调整大小组时出错:", error);
                }
            }

            // 无论如何，都在短暂延迟后进行一次完整的关系更新
            setTimeout(() => {
                try {
                    // 记录当前选中状态，确保更新后不丢失选择
                    const { selectedNodes, selectedGroups } = getCurrentSelection(true);

                    // 强制更新所有关系
                    forceUpdateAllRelationships();
                    logger.debug("拖动操作后重建组关系完成");

                    // 恢复选中状态
                    setTimeout(() => {
                        try {
                            // 清除现有选择
                            if (app.canvas.deselectAllNodes) {
                                app.canvas.deselectAllNodes();
                            }
                            if (app.canvas.deselectAllGroups) {
                                app.canvas.deselectAllGroups();
                            }

                            // 重新选择之前选中的节点和组
                            for (const node of selectedNodes) {
                                if (node && typeof app.canvas.selectNode === 'function') {
                                    app.canvas.selectNode(node, true);
                                }
                            }

                            for (const group of selectedGroups) {
                                if (group && typeof app.canvas.selectGroup === 'function') {
                                    app.canvas.selectGroup(group, true);
                                }
                            }

                            // 更新全局选中状态
                            updateState({
                                currentSelectedNodes: selectedNodes,
                                currentSelectedGroups: selectedGroups
                            });
                        } catch (error) {
                            logger.error("恢复选中状态时出错:", error);
                        }
                    }, 10);
                } catch (error) {
                    logger.error("拖动后更新组关系时出错:", error);
                }
            }, 100);
        }
    };

    // 返回一个清理函数，用于恢复原始方法
    return () => {
        canvas.onMouseMove = originalMouseMove;
        canvas.onMouseUp = originalMouseUp;
    };
}


/**
 * 添加画布前景绘制监听，用于高亮等效果
 * @param {LGraphCanvas} canvas
 */
function setupCanvasDrawListeners(canvas) {
    const originalDrawFrontCanvas = canvas.constructor.prototype.drawFrontCanvas;
    canvas.constructor.prototype.drawFrontCanvas = function () {
        originalDrawFrontCanvas.apply(this, arguments);
        if (!state.hijackEnabled || !this.isDragging) {
            updateState({ hoveredGroup: null });
            return;
        }

        let currentDraggingElement = this.selected_group || this.current_node;
        if (!currentDraggingElement) return;

        updateState({ draggingElement: currentDraggingElement });
        if (currentDraggingElement.group) {
            updateGroupBoundary(currentDraggingElement.group, true);
            updateState({ hoveredGroup: null });
            return;
        }

        // 如果Shift键被按下，跳过悬停检测
        if (state.shiftKeyPressed) {
            updateState({ hoveredGroup: null });
            return;
        }
        // 如果Ctrl键被按下，跳过悬停检测
        // if (state.ctrlKeyPressed) {
        //     updateState({ hoveredGroup: null });
        //     return;
        // }

        const overlappingGroups = [];
        // 首先收集所有组，包括嵌套组
        const allGroups = [];
        for (const group of this.graph?._groups || []) {
            if (group === this.resizingGroup || group === this.selected_group || group === currentDraggingElement) continue;

            // 检查是否会导致循环引用
            let parentGroup = group;
            let shouldSkip = false;
            while (parentGroup) {
                if (parentGroup === currentDraggingElement) {
                    shouldSkip = true;
                    break;
                }
                parentGroup = parentGroup.group;
            }
            if (shouldSkip) continue;

            allGroups.push(group);
        }

        // 计算每个组的面积
        const groupAreas = new Map();
        for (const group of allGroups) {
            try {
                if (group && group.size && Array.isArray(group.size) && group.size.length >= 2) {
                    const area = group.size[0] * group.size[1];
                    if (!isNaN(area) && isFinite(area) && area > 0) {
                        groupAreas.set(group, area);
                    }
                }
            } catch (error) {
                logger.error("计算组面积时出错:", error);
            }
        }

        // 对所有组进行重叠检测
        for (const group of allGroups) {
            // 确保组没有被删除且有有效的属性
            if (group._isDeleted || !group.size || !group._bounding) {
                continue;
            }

            try {
                const overlapResult = checkElementOverlap(currentDraggingElement, group);
                if (overlapResult.isOverlapping) {
                    // 计算这个组的有效面积（考虑嵌套关系）
                    let effectiveArea = groupAreas.get(group) || 0;
                    // 如果是子组，降低其优先级
                    let depth = 0;
                    let parent = group.group;
                    let hasCircularRef = false;

                    // 检测循环引用
                    const visited = new Set();
                    while (parent) {
                        if (visited.has(parent)) {
                            hasCircularRef = true;
                            logger.warn("检测到循环引用，跳过组:", group.title || "未命名组");
                            break;
                        }
                        visited.add(parent);
                        depth++;
                        parent = parent.group;
                    }

                    if (hasCircularRef) continue;

                    // 根据深度调整比率，使得更深层的组有更高的优先级
                    const depthFactor = Math.pow(0.5, depth); // 每层深度降低一半面积影响
                    const adjustedRatio = overlapResult.ratio * (1 + (1 - depthFactor));

                    overlappingGroups.push({
                        group,
                        ratio: adjustedRatio,
                        depth,
                        area: effectiveArea
                    });
                }
            } catch (error) {
                logger.error("计算组重叠时出错:", error);
                continue;
            }
        }

        let newHoveredGroup = null;
        if (overlappingGroups.length > 0) {
            // 根据多个因素排序：重叠比例、深度（优先选择更深的组）、面积（在相似重叠比例时优先选择更小的组）
            overlappingGroups.sort((a, b) => {
                // 如果重叠比例相差不大（小于10%），考虑其他因素
                if (Math.abs(a.ratio - b.ratio) < 0.1) {
                    // 优先选择更深的组
                    if (a.depth !== b.depth) {
                        return b.depth - a.depth;
                    }
                    // 深度相同时，选择更小的组
                    return a.area - b.area;
                }
                // 重叠比例差异大时，直接按比例排序
                return b.ratio - a.ratio;
            });

            newHoveredGroup = overlappingGroups[0].group;
        }

        // 更新悬停状态
        if (state.hoveredGroup !== newHoveredGroup) {
            updateState({ hoveredGroup: newHoveredGroup });
        }

        // 绘制高亮效果
        if (state.hoveredGroup) {
            drawGroupHighlight(state.hoveredGroup, this.ctx, state.hoveredGroup.color || "#335");
        }
    };

    // 返回一个清理函数，用于恢复原始方法
    return () => {
        canvas.constructor.prototype.drawFrontCanvas = originalDrawFrontCanvas;
    };
}

/**
 * 添加拖放完成事件监听
 * @param {HTMLCanvasElement} canvasElement
 */
function setupDropListeners(canvasElement) {
    const onPointerUp = function (e) {
        // 如果Shift键被按下，跳过拖放操作
        if (state.shiftKeyPressed) {
            return;
        }
        // 如果Ctrl键被按下，跳过拖放操作
        // if (state.ctrlKeyPressed) {
        //     return;
        // }

        // 仅在开启劫持时处理
        if (!state.hijackEnabled) {
            return;
        }

        // 新前端：优先使用指针位置解析目标组
        let targetGroup = null;
        try {
            if (app?.canvas && app?.graph && e) {
                app.canvas.adjustMouseEvent?.(e);
                if (typeof e.canvasX === 'number' && typeof e.canvasY === 'number') {
                    targetGroup = app.graph.getGroupOnPos(e.canvasX, e.canvasY) || null;
                }
            }
        } catch (err) {
            logger.error("根据指针位置解析目标组失败:", err);
        }

        // 回退旧逻辑：使用悬停组
        if (!targetGroup) {
            targetGroup = state.hoveredGroup || null;
        }

        // 无有效目标组则返回
        if (!targetGroup) return;

        // 使用 `getCurrentSelection` 获取所有选中的对象（包含节点与组）
        const { selectedNodes, selectedGroups } = getCurrentSelection(true);

        // 如果有多个选中项，优先处理多选
        if (selectedNodes.length > 0 || selectedGroups.length > 0) {
            logger.debug(`将 ${selectedNodes.length} 个节点和 ${selectedGroups.length} 个组通过拖放添加到组 '${targetGroup.title}'`);
            addSelectedItemsToGroup(targetGroup, selectedNodes, selectedGroups);
        }
        // 如果没有多选，尝试使用 draggingElement 作为备选
        else if (state.draggingElement) {
            const { draggingElement } = state;
            if (draggingElement === targetGroup) return; // 不能将一个元素放入其自身
            logger.debug(`将单个拖动元素 '${draggingElement.title}' 添加到组 '${targetGroup.title}'`);
            const nodesToAdd = (typeof window !== 'undefined' && window.LGraphNode && draggingElement instanceof window.LGraphNode) ? [draggingElement] : [];
            const groupsToAdd = (typeof window !== 'undefined' && window.LGraphGroup && draggingElement instanceof window.LGraphGroup) ? [draggingElement] : [];
            addSelectedItemsToGroup(targetGroup, nodesToAdd, groupsToAdd);
        }

        // 操作完成后，清理状态
        updateState({ hoveredGroup: null, draggingElement: null });
    };
    canvasElement.addEventListener("pointerup", onPointerUp, true);
    return onPointerUp; // Return listener for cleanup
}

/**
 * 设置撤销/重做事件监听
 * @returns {Function} 清理函数
 */
function setupUndoRedoListeners() {
    // 处理撤销/重做操作的统一函数
    const handleUndoRedo = () => {
        logger.debug("检测到撤销/重做操作，准备重建组关系...");
        setTimeout(() => {
            try {
                if (state.hijackEnabled) {
                    logger.debug("开始重建组关系。");
                    rebuildAllGroupRelationships();
                    logger.debug("组关系重建完成。");
                }
            } catch (error) {
                logger.error("重建组关系时发生错误:", error);
            } finally {
                app.isGroupAssistantRestoring = false;
            }
        }, GroupAssistantConfig.UNDO_REDO_DELAY || 100);
    };

    // 键盘事件处理
    const onKeyDown = (e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = e.key.toUpperCase();
            if ((key === 'Y' && !e.shiftKey) || (key === 'Z' && e.shiftKey) || (key === 'Z' && !e.shiftKey)) {
                app.isGroupAssistantRestoring = true;
            }
        }
    };

    const onKeyUp = (e) => {
        if (app.isGroupAssistantRestoring) {
            const key = e.key.toUpperCase();
            if (['Z', 'Y', 'CONTROL', 'META'].includes(key)) {
                handleUndoRedo();
            }
        }
    };

    // 监听 ComfyUI 的撤销/重做方法
    if (app.graph?.constructor?.prototype) {
        const proto = app.graph.constructor.prototype;

        // 保存原始的撤销/重做方法
        const originalUndo = proto.undo;
        const originalRedo = proto.redo;

        // 重写撤销方法
        proto.undo = function () {
            app.isGroupAssistantRestoring = true;
            const result = originalUndo.apply(this, arguments);
            handleUndoRedo();
            return result;
        };

        // 重写重做方法
        proto.redo = function () {
            app.isGroupAssistantRestoring = true;
            const result = originalRedo.apply(this, arguments);
            handleUndoRedo();
            return result;
        };

        // 返回清理函数时恢复原始方法
        const cleanup = () => {
            if (proto.undo === originalUndo || proto.redo === originalRedo) return;
            proto.undo = originalUndo;
            proto.redo = originalRedo;
        };

        // 添加事件监听
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);

        // 返回组合的清理函数
        return () => {
            cleanup();
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
        };
    }

    // 如果无法重写方法，至少保留键盘事件监听
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    return () => {
        window.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('keyup', onKeyUp, true);
    };
}


// ================ 插件注册 ================

app.registerExtension({
    name: "comfyui.group_assistant",

    // 定义可用的命令
    commands: [
        {
            id: 'group-assistant.unlink',
            label: i18n.t("cmd_unlink"),
            icon: 'p-button-icon group-assistant-unlink-icon',
            function: unlinkSelectedItems
        }
    ],

    async setup() {
        // 首先初始化i18n模块
        i18n.init();

        // 启动日志不受日志级别约束，直接使用console.log
        console.log(`💡${i18n.t("log_plugin_started")} ${i18n.t("plugin_version", window.GroupAssistant_Version || "1.0.x")}`);

        try {
            // 创建UI
            createUI();

            // 设置撤销/重做监听
            const cleanupUndoRedo = setupUndoRedoListeners();

            // 设置标题编辑完成监听
            const cleanupTitleEdit = setupTitleEditListener();

            // 设置Shift键状态监听
            const cleanupShiftKey = setupShiftKeyListeners();

            /* // 初始化的逻辑已统一移至ui.js的graph-ready事件中，避免重复执行
            // 根据开关的初始状态决定是否启用
            if (state.hijackEnabled) {
                enableHijack();
            }
            */

            // --- 设置其他事件监听 ---
            if (app.canvas) {
                const cleanupSelection = setupSelectionListeners(app.canvas);
                const cleanupDrag = setupDragListeners(app.canvas);
                const cleanupDraw = setupCanvasDrawListeners(app.canvas);
                const pointerUpListener = setupDropListeners(app.canvas.canvas);

                // 设置 Ctrl+G 组合键劫持
                const cleanupGroupHijack = hijackOnGroup();

                // --- 监听粘贴和加载操作 ---

                // 监听粘贴/插入操作 (Ctrl+V, 从侧边栏拖拽)
                const originalPaste = app.canvas.pasteFromClipboard;
                app.canvas.pasteFromClipboard = function () {
                    originalPaste?.apply(this, arguments);
                    if (state.hijackEnabled) {
                        setTimeout(() => {
                            logger.debug(i18n.t("log_paste_detected"));
                            recalculateSelectedItemsRelationships();
                        }, 50);
                    }
                };

                // 监听完整工作流加载 (文件拖放, 粘贴工作流JSON)
                const originalLoadGraphData = app.loadGraphData;
                app.loadGraphData = function (graphData) {
                    const promise = originalLoadGraphData.apply(this, arguments);
                    promise.then(() => {
                        if (state.hijackEnabled) {
                            setTimeout(() => {
                                logger.debug(i18n.t("log_workflow_loaded"));
                                rebuildAllGroupRelationships();
                            }, 100);
                        }
                    });
                    return promise;
                };


                // 监听组的创建 - 使用 LGraph 的 add 方法
                const originalAdd = app.graph.add;
                app.graph.add = function (node_or_group) {
                    try {
                        // 如果是组，确保初始化干净的状态
                        if (node_or_group instanceof LiteGraph.LGraphGroup) {
                            // 确保组有干净的初始状态，避免继承已删除组的属性
                            if (!node_or_group._bounding) {
                                node_or_group._bounding = [0, 0, 0, 0];
                            }
                            if (!node_or_group._nodes) {
                                node_or_group._nodes = [];
                            }
                            if (!node_or_group._children) {
                                node_or_group._children = new Set();
                            }
                            node_or_group._isDeleted = false;
                        }

                        const result = originalAdd.apply(this, arguments);
                        return result;
                    } catch (error) {
                        logger.error("在add方法中出错:", error);
                        // 尝试使用原始方法
                        try {
                            return originalAdd.apply(this, arguments);
                        } catch (innerError) {
                            logger.error("调用原始add方法时出错:", innerError);
                            return null;
                        }
                    }
                };

                // 监听组的删除 - 劫持 LGraph 的 remove 方法
                const originalRemove = app.graph.remove;
                app.graph.remove = function (node_or_group) {
                    // 如果是组且功能已启用，处理其子节点和子组
                    if (node_or_group instanceof LiteGraph.LGraphGroup && state.hijackEnabled) {
                        logger.debug(`检测到组删除: ${node_or_group.title || "未命名组"}`);

                        try {
                            // 保存子节点和子组的引用
                            const orphanedNodes = node_or_group._nodes ? [...(node_or_group._nodes || [])].filter(node => node != null) : [];
                            const orphanedGroups = [];
                            if (node_or_group._children) {
                                for (const child of node_or_group._children) {
                                    if (child instanceof LiteGraph.LGraphGroup && child !== node_or_group) {
                                        orphanedGroups.push(child);
                                    }
                                }
                            }

                            // 首先清理所有引用关系，防止循环引用
                            // 1. 清理子节点对组的引用
                            orphanedNodes.forEach(node => {
                                if (node && node.group === node_or_group) node.group = null;
                            });

                            // 2. 清理子组对组的引用
                            orphanedGroups.forEach(group => {
                                if (group && group.group === node_or_group) group.group = null;
                            });

                            // 3. 清理父组对该组的引用
                            if (node_or_group.group && node_or_group.group._children) {
                                node_or_group.group._children.delete(node_or_group);
                            }
                            node_or_group.group = null;

                            // 4. 清空组自身的子节点和子组集合
                            if (node_or_group._nodes) node_or_group._nodes = [];
                            if (node_or_group._children) node_or_group._children.clear();

                            // 执行原始的删除操作
                            const result = originalRemove.apply(this, arguments);

                            // 从全局组列表移除
                            const idx = app.graph._groups ? app.graph._groups.indexOf(node_or_group) : -1;
                            if (idx !== -1) app.graph._groups.splice(idx, 1);

                            // 彻底清理组对象的所有属性
                            node_or_group._bounding = null;
                            node_or_group._pos = null;
                            node_or_group._size = null;
                            node_or_group._nodes = null;
                            node_or_group._children = null;
                            node_or_group.graph = null;

                            // 将组对象标记为已删除
                            node_or_group._isDeleted = true;

                            // 处理孤儿节点和组
                            setTimeout(() => {
                                try {
                                    handleOrphanedItems(orphanedNodes, orphanedGroups);
                                } catch (error) {
                                    logger.error("处理孤儿项时出错:", error);
                                }
                            }, 10);

                            return result;
                        } catch (error) {
                            logger.error("删除组时出错:", error);
                            // 出错时尝试使用原始方法
                            return originalRemove.apply(this, arguments);
                        }
                    }

                    // 对于其他情况，直接调用原始方法
                    return originalRemove.apply(this, arguments);
                };

                // 返回一个清理函数，用于在扩展被禁用或移除时恢复所有被修改的功能
                return () => {
                    logger.debug("正在清理组助手插件...");
                    if (state.hijackEnabled) disableHijack();

                    cleanupSelection();
                    cleanupDrag();
                    cleanupDraw();
                    cleanupUndoRedo();
                    cleanupGroupHijack();
                    cleanupTitleEdit();
                    cleanupShiftKey();
                    app.canvas.canvas.removeEventListener("pointerup", pointerUpListener, true);


                    // 恢复原始的add/remove方法
                    app.graph.add = originalAdd;
                    app.graph.remove = originalRemove;

                    // 恢复原始的粘贴和加载方法
                    if (originalPaste) app.canvas.pasteFromClipboard = originalPaste;
                    if (originalLoadGraphData) app.loadGraphData = originalLoadGraphData;

                    if (state.toggleButton?.parentElement) {
                        state.toggleButton.parentElement.remove();
                    }
                    // 重置所有状态
                    updateState({
                        toggleButton: null,
                        hijackEnabled: false,
                        originalRecomputeInsideNodes: null,
                        hoveredGroup: null,
                        draggingElement: null,
                        isProcessingGroupOperation: false,
                        currentSelectedNodes: [],
                        currentSelectedGroups: [],
                    });
                    logger.debug("组助手插件清理完成");
                };
            }

        } catch (error) {
            logger.error("组助手功能初始化失败:", error);
        }
    },

    // 获取选中工具箱命令
    getSelectionToolboxCommands: (selectedItem) => {
        // 只有当选中的元素有组关系时才显示按钮
        if (selectedItem?.group && state.hijackEnabled) {
            return ['group-assistant.unlink'];
        }
        return [];
    },
}); 