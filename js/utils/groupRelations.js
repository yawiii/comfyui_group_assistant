/**
 * @file 组关系管理与功能劫持
 * @description 包含所有对节点/组的层级关系进行增、删、改、查的函数，以及启用/禁用插件核心功能的逻辑。
 */

import { app } from "../../../../scripts/app.js";
import { state, updateState } from "./state.js";
import { updateGroupBoundary, sortGroupsForRenderOrder, isNodeInsideGroup, isGroupInsideGroup, checkElementOverlap } from "./boundary.js";
import { updateToggleButtonState } from "../ui.js";
import { logger } from "./logger.js";
import { i18n } from "./i18n.js";

/**
 * 自定义 recomputeInsideNodes 函数，以防止自动更新组。
 * 插件会手动处理关系更新。
 */
function customRecomputeInsideNodes() {
    // 这个函数故意留空，以防止 LiteGraph
    // 自动根据位置重新计算节点关系。
    // group-assistant 插件通过用户操作手动管理这些关系
    // 以支持嵌套组。
    if (!this.graph) {
        logger.warn("Group not attached to a graph");
        return;
    }
    return;
}

// ================ 功能劫持 ================

// 保存原始的recomputeInsideNodes方法
let originalRecomputeInsideNodes = null;

/**
 * 初始化组关系管理
 * @param {Object} app ComfyUI应用实例
 */
function initGroupRelations(app) {
    // 保存原始方法
    if (!originalRecomputeInsideNodes) {
        originalRecomputeInsideNodes = app.graph.LGraphGroup.prototype.recomputeInsideNodes;
    }
}

/**
 * 启用自定义组关系管理
 * @param {Object} app ComfyUI应用实例
 */
function enableCustomGroupRelations(app) {
    if (!originalRecomputeInsideNodes) {
        initGroupRelations(app);
    }

    // 重写recomputeInsideNodes方法
    app.graph.LGraphGroup.prototype.recomputeInsideNodes = function () {
        // 如果组没有关联到图，抛出错误
        if (!this.graph) {
            throw new Error("Group not attached to a graph");
        }

        // 保持现有的组关系不变
        // 只在手动添加/移除节点时更新关系
        return;
    };
}

/**
 * 禁用自定义组关系管理，恢复原生行为
 * @param {Object} app ComfyUI应用实例
 */
function disableCustomGroupRelations(app) {
    if (originalRecomputeInsideNodes) {
        // 恢复原始方法
        app.graph.LGraphGroup.prototype.recomputeInsideNodes = originalRecomputeInsideNodes;

        // 重新计算所有组的节点关系
        if (app.graph && app.graph._groups) {
            for (const group of app.graph._groups) {
                group.recomputeInsideNodes();
            }
        }
    }
}

/**
 * 手动添加节点到组
 * @param {Object} group 目标组
 * @param {Object} node 要添加的节点
 */
function addNodeToGroup(group, node) {
    if (!group._nodes.includes(node)) {
        group._nodes.push(node);
        group._children.add(node);
    }
}

/**
 * 手动从组中移除节点
 * @param {Object} group 目标组
 * @param {Object} node 要移除的节点
 */
function removeNodeFromGroup(group, node) {
    const index = group._nodes.indexOf(node);
    if (index !== -1) {
        group._nodes.splice(index, 1);
        group._children.delete(node);
    }
}

/**
 * 重建所有组的关系
 * 该函数会清空现有的父子关系，然后根据节点和组的实际位置重新计算它们。
 * - 它不会改变任何组的边界大小。
 * - 它会重新排序组的渲染层级，以确保子组和子节点显示在父组之上。
 */
export function rebuildAllGroupRelationships() {
    if (!app.graph) return;

    logger.debug(i18n.t("log_rebuild_start"));

    try {
        // 数据完整性检查
        if (!app.graph._nodes || !app.graph._groups) {
            logger.warn("图形数据不完整，取消重新计算组关系");
            return;
        }

        // 检测并修复循环引用
        const problematicGroups = checkGroupCycles();
        if (problematicGroups.length > 0) {
            logger.warn(i18n.t("log_circular_ref", problematicGroups.length));
            // 修复循环引用
            for (const group of problematicGroups) {
                group.group = null;
            }
        }

        // 使用分批处理避免UI阻塞
        separateAllRelationships();

        // 将剩余步骤移至下一个事件循环，让UI有机会更新
        setTimeout(() => {
            rebuildGroupToGroupRelations();
        }, 0);
    } catch (error) {
        logger.error("重新计算组关系时出错:", error);
    }
}

/**
 * 检测组之间的循环引用
 * @returns {Array} 存在循环引用的组列表
 */
function checkGroupCycles() {
    const problematicGroups = [];

    if (!app.graph || !app.graph._groups) return problematicGroups;

    for (const group of app.graph._groups) {
        if (!group || group._isDeleted) continue;

        const visited = new Set();
        let current = group;

        try {
            while (current && current.group) {
                if (!current.group || current.group._isDeleted) {
                    // 父组无效，清除引用
                    current.group = null;
                    break;
                }

                if (visited.has(current.group)) {
                    problematicGroups.push(current);
                    // 修复循环引用
                    current.group = null;
                    break;
                }
                visited.add(current);
                current = current.group;
            }
        } catch (error) {
            logger.error("检测循环引用时出错:", error);
            // 出错时，尝试清除当前组的父组引用
            if (group && group.group) {
                group.group = null;
                problematicGroups.push(group);
            }
        }
    }

    return problematicGroups;
}

/**
 * 分离所有关系（清除当前关系）
 */
function separateAllRelationships() {
    try {
        if (!app.graph) return;

        // 清除所有节点和组的父级引用
        for (const node of app.graph._nodes || []) {
            node.group = null;
        }

        // 清空所有组的子节点和子组列表
        for (const group of app.graph._groups || []) {
            group.group = null;
            group._nodes = [];
            group._children = new Set();
        }
    } catch (error) {
        logger.error("分离关系时出错:", error);
    }
}

/**
 * 重建组到组的关系
 */
function rebuildGroupToGroupRelations() {
    try {
        if (!app.graph || !app.graph._groups) return;

        // 计算每个组的面积
        const groupAreas = new Map();
        for (const group of app.graph._groups) {
            if (!group || group._isDeleted || !group.size) continue;
            const area = group.size[0] * group.size[1];
            groupAreas.set(group, area);
        }

        // 按面积从大到小排序组
        const sortedGroups = [...app.graph._groups].filter(g => g && !g._isDeleted).sort((a, b) => {
            return (groupAreas.get(b) || 0) - (groupAreas.get(a) || 0);
        });

        // 分批处理组与组之间的关系
        processGroupToGroupRelationsBatch(0, sortedGroups, groupAreas);
    } catch (error) {
        logger.error("重建组关系时出错:", error);
    }
}

/**
 * 分批处理组到组的关系
 * @param {number} startIndex - 起始组索引
 * @param {Array} sortedGroups - 排序后的组
 * @param {Map} groupAreas - 组面积映射
 */
function processGroupToGroupRelationsBatch(startIndex, sortedGroups, groupAreas) {
    try {
        const batchSize = 25; // 每批处理25个组，这是一个平衡值
        const endIndex = Math.min(startIndex + batchSize, sortedGroups.length);

        // 确定组与组之间的嵌套关系
        for (let i = startIndex; i < endIndex; i++) {
            const innerGroup = sortedGroups[i];

            // 找出所有包含这个组的外层组
            const containingGroups = [];
            for (const outerGroup of sortedGroups) {
                if (innerGroup === outerGroup) continue;

                // 检查是否会导致循环引用
                let current = outerGroup.group;
                let wouldCreateCycle = false;
                while (current) {
                    if (current === innerGroup) {
                        wouldCreateCycle = true;
                        break;
                    }
                    current = current.group;
                }
                if (wouldCreateCycle) continue;

                if (isGroupInsideGroup(innerGroup, outerGroup)) {
                    containingGroups.push(outerGroup);
                }
            }

            // 如果有包含这个组的外层组，选择最小的那个作为父组
            if (containingGroups.length > 0) {
                containingGroups.sort((a, b) => groupAreas.get(a) - groupAreas.get(b));
                const parentGroup = containingGroups[0];
                innerGroup.group = parentGroup;
                if (parentGroup._children) {
                    parentGroup._children.add(innerGroup);
                }
            }
        }

        // 如果还有组需要处理
        if (endIndex < sortedGroups.length) {
            setTimeout(() => processGroupToGroupRelationsBatch(endIndex, sortedGroups, groupAreas), 0);
        } else {
            // 完成组关系处理后，继续处理节点与组的关系
            setTimeout(() => processNodeToGroupRelationsBatch(0, sortedGroups, groupAreas), 0);
        }
    } catch (error) {
        logger.error("处理组间关系时出错:", error);
        // 即使出错，也尝试继续下一步
        setTimeout(() => processNodeToGroupRelationsBatch(0, sortedGroups, groupAreas), 0);
    }
}


/**
 * 分批处理节点到组的关系
 * @param {number} startIndex - 起始节点索引
 * @param {Array} sortedGroups - 排序后的组
 * @param {Map} groupAreas - 组面积映射
 */
function processNodeToGroupRelationsBatch(startIndex, sortedGroups, groupAreas) {
    try {
        if (!app.graph || !app.graph._nodes) return;

        const batchSize = 100; // 每批处理的节点数
        const endIndex = Math.min(startIndex + batchSize, app.graph._nodes.length);

        for (let i = startIndex; i < endIndex; i++) {
            const node = app.graph._nodes[i];

            // 找出所有包含这个节点的组
            const containingGroups = [];
            for (const group of sortedGroups) {
                if (isNodeInsideGroup(node, group)) {
                    containingGroups.push(group);
                }
            }

            // 如果有包含这个节点的组，选择最小的那个作为父组
            if (containingGroups.length > 0) {
                containingGroups.sort((a, b) => groupAreas.get(a) - groupAreas.get(b));
                const parentGroup = containingGroups[0];
                node.group = parentGroup;
                parentGroup._nodes.push(node);
                parentGroup._children.add(node);
            }
        }

        // 如果还有节点需要处理
        if (endIndex < app.graph._nodes.length) {
            setTimeout(() => processNodeToGroupRelationsBatch(endIndex, sortedGroups, groupAreas), 0);
        } else {
            // 完成所有处理
            setTimeout(finalizeRebuild, 0);
        }
    } catch (error) {
        logger.error("处理节点关系时出错:", error);
        // 尝试完成流程
        setTimeout(finalizeRebuild, 0);
    }
}

/**
 * 完成重建过程
 */
function finalizeRebuild() {
    try {
        sortGroupsForRenderOrder();

        if (app.canvas) {
            app.canvas.setDirty(true, true);

            // 更新SelectionToolbox状态
            if (app.canvas.onSelectionChange) {
                const selectedNodes = app.canvas.selected_nodes || {};
                app.canvas.onSelectionChange(selectedNodes);
            }
        }

        logger.debug(i18n.t("log_rebuild_complete"));
    } catch (error) {
        logger.error("完成重建过程时出错:", error);
    }
}

/**
 * 启用组小助手功能
 */
export function enableHijack() {
    logger.debug(i18n.t("log_enable"));
    const proto = window.LGraphGroup?.prototype;
    if (proto) {
        if (state.originalRecomputeInsideNodes === null) {
            updateState({ originalRecomputeInsideNodes: proto.recomputeInsideNodes });
        }
        proto.recomputeInsideNodes = customRecomputeInsideNodes;

        // 更新状态
        updateState({ hijackEnabled: true });

        // 更新按钮状态
        updateToggleButtonState();

        // 更新工具箱状态
        if (app.canvas) {
            app.canvas.setDirty(true, true);
            if (app.canvas.onSelectionChange) {
                app.canvas.onSelectionChange(app.canvas.selected_nodes);
            }
        }

        // 延迟重建组关系，避免UI阻塞
        logger.debug("将在10ms后开始重建组关系");
        setTimeout(() => {
            try {
                if (app.graph && app.graph._groups) {
                    rebuildAllGroupRelationships();
                }
            } catch (error) {
                logger.error("重建组关系时出错:", error);
            }
        }, 10);
    }
}

/**
 * 禁用组小助手功能
 */
export function disableHijack() {
    logger.debug(i18n.t("log_disable"));
    const proto = window.LGraphGroup?.prototype;
    if (proto && state.originalRecomputeInsideNodes) {
        proto.recomputeInsideNodes = state.originalRecomputeInsideNodes;
        updateState({ originalRecomputeInsideNodes: null });

        // 使用原生方法重新计算所有组关系
        forceRecalculateRelationships(true);

        // 更新状态
        updateState({ hijackEnabled: false });

        // 更新按钮状态
        updateToggleButtonState();

        // 更新工具箱状态
        if (app.canvas) {
            app.canvas.setDirty(true, true);
            if (app.canvas.onSelectionChange) {
                app.canvas.onSelectionChange(app.canvas.selected_nodes);
            }
        }
    }
}

// ================ 关系查询 ================

/**
 * 获取当前选中的节点和组
 * @param {boolean} strict - 是否只返回严格意义上的选中项（忽略node_over等瞬时状态）
 * @returns {{selectedNodes: LGraphNode[], selectedGroups: LGraphGroup[]}}
 */
export function getCurrentSelection(strict = false) {
    const selectedNodes = [];
    const selectedGroups = [];

    // 以 canvas.selectedItems 作为唯一可靠的数据来源
    if (app.canvas && app.canvas.selectedItems) {
        for (const item of app.canvas.selectedItems) {
            if (item instanceof window.LGraphNode) {
                if (!selectedNodes.includes(item)) {
                    selectedNodes.push(item);
                }
            } else if (item instanceof window.LGraphGroup) {
                if (!selectedGroups.includes(item)) {
                    selectedGroups.push(item);
                }
            }
        }
    }

    // 兼容旧的逻辑和非严格模式，以防 selectedItems 未完全更新
    if (!strict) {
        if (app.canvas) {
            // 处理节点
            const nodeProps = ['selected_node', 'current_node', 'node_dragged', 'node_over'];
            for (const prop of nodeProps) {
                const node = app.canvas[prop];
                if (node && !selectedNodes.includes(node)) {
                    selectedNodes.push(node);
                }
            }
            // 处理组
            if (app.canvas.selected_group && !selectedGroups.includes(app.canvas.selected_group)) {
                selectedGroups.push(app.canvas.selected_group);
            }
        }
    }

    // 我们自己维护的状态作为补充
    for (const node of state.currentSelectedNodes) {
        if (node && !selectedNodes.includes(node)) {
            selectedNodes.push(node);
        }
    }
    for (const group of state.currentSelectedGroups) {
        if (group && !selectedGroups.includes(group)) {
            selectedGroups.push(group);
        }
    }

    // 输出调试信息
    if (selectedGroups.length > 0) {
        logger.debug(`选中组数量: ${selectedGroups.length}，组标题: ${selectedGroups.map(g => g.title || "未命名组").join(", ")}`);
    }

    return { selectedNodes, selectedGroups };
}


// ================ 关系操作 ================

/**
 * 将选中的节点和组添加到目标组中
 * @param {LGraphGroup} group - 目标组
 * @param {Array} selectedNodes - 选中的节点数组
 * @param {Array} selectedGroups - 选中的组数组
 */
export function addSelectedItemsToGroup(group, selectedNodes = [], selectedGroups = []) {
    if (!group || group._isDeleted || state.isProcessingGroupOperation) return;

    updateState({ isProcessingGroupOperation: true });

    try {
        // 确保组有必要的属性
        if (!group._nodes) group._nodes = [];
        if (!group._children) group._children = new Set();

        const groupsToUpdate = new Set();
        const nodes = (selectedNodes || []).filter(node => node != null);
        const groups = (selectedGroups || []).filter(g => g != null && !g._isDeleted && g !== group);

        // 处理节点
        for (const node of nodes) {
            // 从原组中移除
            if (node.group) {
                const oldGroup = node.group;
                if (oldGroup === group) continue; // 节点已在该组中

                if (oldGroup && !oldGroup._isDeleted) {
                    oldGroup._nodes = oldGroup._nodes.filter(n => n !== node);
                    oldGroup._children.delete(node);
                    groupsToUpdate.add(oldGroup);
                }
            }
            // 添加到新组
            node.group = group;
            if (!group._nodes.includes(node)) {
                group._nodes.push(node);
            }
            group._children.add(node);
        }

        // 处理组
        for (const childGroup of groups) {
            // 检查是否会导致循环引用：不能将一个组添加到它自己的子孙组中
            let parent = group.group;
            let wouldCreateCycle = false;
            while (parent) {
                if (parent === childGroup) {
                    wouldCreateCycle = true;
                    break;
                }
                parent = parent.group;
            }
            if (wouldCreateCycle) {
                logger.warn(`检测到添加组 '${childGroup.title || "未命名"}' 到 '${group.title || "未命名"}' 会导致循环引用，已跳过。`);
                continue;
            }

            // 从原父组中移除
            if (childGroup.group) {
                const oldParentGroup = childGroup.group;
                if (oldParentGroup === group) continue;

                if (oldParentGroup && !oldParentGroup._isDeleted) {
                    oldParentGroup._children.delete(childGroup);
                    groupsToUpdate.add(oldParentGroup);
                }
            }
            // 添加到新组
            childGroup.group = group;
            group._children.add(childGroup);
        }

        // 将目标组也添加到更新列表中
        groupsToUpdate.add(group);

        // 延迟更新组边界，避免多次重复计算
        setTimeout(() => {
            try {
                // 先更新所有受影响的原组
                for (const groupToUpdate of groupsToUpdate) {
                    if (groupToUpdate && !groupToUpdate._isDeleted && groupToUpdate !== group) {
                        updateGroupBoundary(groupToUpdate, false, null, true);
                    }
                }

                // 最后更新目标组，并允许更新其父组
                if (!group._isDeleted) {
                    updateGroupBoundary(group, true, null, true);
                }

                // 更新渲染顺序并刷新画布
                sortGroupsForRenderOrder();
                if (app.canvas) {
                    app.canvas.setDirty(true, true);

                    // 手动触发选择变更事件，以刷新选择工具栏
                    if (app.canvas.onSelectionChange) {
                        const selection = app.canvas.getSelection ? app.canvas.getSelection() : (app.canvas.selected_nodes || {});
                        app.canvas.onSelectionChange(selection);
                    }
                }
            } catch (error) {
                logger.error("更新组边界时出错:", error);
            }
        }, 0);

    } catch (error) {
        logger.error("添加选中项到组时出错:", error);
    } finally {
        updateState({ isProcessingGroupOperation: false });
    }
}

/**
 * 智能确定哪些节点和组应该添加到新组中
 * @returns {{topLevelNodes: LGraphNode[], topLevelGroups: LGraphGroup[]}}
 */
export function determineElementsForNewGroup() {
    if (!app.graph) {
        return { topLevelNodes: [], topLevelGroups: [] };
    }

    try {
        logger.debug("开始分析选中元素...");
        const startTime = performance.now();

        const { selectedNodes, selectedGroups } = getCurrentSelection(true);

        if (selectedNodes.length === 0 && selectedGroups.length === 0) {
            return { topLevelNodes: [], topLevelGroups: [] };
        }

        // 防止在处理大量元素时卡死，设置最大处理数量
        const MAX_ELEMENTS = 500;
        if (selectedNodes.length + selectedGroups.length > MAX_ELEMENTS) {
            logger.warn(`选中元素超过${MAX_ELEMENTS}个，使用简化分析`);
            return {
                topLevelNodes: selectedNodes.slice(0, MAX_ELEMENTS),
                topLevelGroups: selectedGroups.slice(0, Math.max(MAX_ELEMENTS - selectedNodes.length, 0))
            };
        }

        // 轻量级检查组关系，不进行完整重建
        const childrenOfSelectedGroups = new Set();

        // 收集所有子元素（仅一级子节点，不递归）
        for (const group of selectedGroups) {
            // 收集子节点
            if (group._nodes) {
                for (const node of group._nodes) {
                    if (node) childrenOfSelectedGroups.add(node);
                }
            }

            // 收集子组（仅直接子组）
            if (group._children) {
                for (const child of group._children) {
                    if (child instanceof window.LGraphGroup) {
                        childrenOfSelectedGroups.add(child);
                    }
                }
            }
        }

        // 过滤出顶层节点和组
        const topLevelNodes = selectedNodes.filter(node => !childrenOfSelectedGroups.has(node));
        const topLevelGroups = selectedGroups.filter(g => !childrenOfSelectedGroups.has(g));

        const endTime = performance.now();
        logger.debug(`分析完成，耗时: ${Math.round(endTime - startTime)}ms，顶级节点: ${topLevelNodes.length}，顶级组: ${topLevelGroups.length}`);

        return { topLevelNodes, topLevelGroups };
    } catch (error) {
        logger.error("分析选中元素时出错:", error);
        // 出错时返回所有选中的节点和组，确保功能仍然可用
        const { selectedNodes, selectedGroups } = getCurrentSelection(true);
        return { topLevelNodes: selectedNodes, topLevelGroups: selectedGroups };
    }
}

/**
 * 清除组与其子节点和子组的关系
 * @param {LGraphGroup} group - 需要清除关系的组
 */
export function clearGroupRelationships(group) {
    if (!group) return;

    if (group._nodes) {
        for (const node of Array.from(group._nodes)) {
            if (node.group === group) node.group = null;
        }
        group._nodes = [];
    }

    if (group._children) {
        for (const child of Array.from(group._children)) {
            if (child.group === group) child.group = null;
        }
        group._children = new Set();
    }

    if (group.group) {
        group.group._children.delete(group);
        group.group = null;
    }
}

/**
 * 将选中的对象从其父组中移除
 */
export function unlinkSelectedItems() {
    if (!state.hijackEnabled) {
        logger.debug("组小助手功能未开启，此功能仅在组小助手开启时有效");
        return;
    }

    logger.debug(i18n.t("log_unlink_start"));

    // 使用严格模式获取选择，避免误操作悬停的元素
    const { selectedNodes, selectedGroups } = getCurrentSelection(true);

    if (selectedNodes.length === 0 && selectedGroups.length === 0) {
        logger.debug(i18n.t("log_unlink_none"));
        return;
    }

    const groupsToUpdate = new Set();
    const groupCount = selectedGroups.length;
    let independentNodesUnlinked = 0;

    // 首先，处理选中组的解除关系
    for (const group of selectedGroups) {
        const parentGroup = group.group;

        if (parentGroup) {
            // 只解除与父组的关系，保留子节点和子组
            group.group = null;
            parentGroup._children.delete(group);
            groupsToUpdate.add(parentGroup);
        }
    }

    // 接下来，处理独立选中的节点
    for (const node of selectedNodes) {
        const parentGroup = node.group;
        if (parentGroup) {
            node.group = null;
            parentGroup._nodes = parentGroup._nodes.filter(n => n !== node);
            parentGroup._children.delete(node);
            groupsToUpdate.add(parentGroup);
            independentNodesUnlinked++;
        }
    }

    if (groupCount > 0 || independentNodesUnlinked > 0) {
        for (const group of groupsToUpdate) {
            updateGroupBoundary(group, true);
        }

        app.canvas.setDirty(true, true);

        if (app.canvas.onSelectionChange) {
            app.canvas.onSelectionChange(app.canvas.selected_nodes);
        }

        let message = "";
        if (groupCount > 0) {
            message += i18n.t("log_unlink_complete", groupCount);
        }
        if (independentNodesUnlinked > 0) {
            if (groupCount > 0) message += "，同时";
            message += i18n.t("log_unlink_nodes", independentNodesUnlinked);
        }
        logger.debug(message);
    } else {
        logger.debug(i18n.t("log_unlink_none"));
    }
}

// ================ 关系同步/迁移 ================

/**
 * 迁移现有的节点和组关系到组小助手系统
 */
export function migrateExistingRelationships() {
    if (!app.graph || !app.graph._groups) return;

    const groupRelationships = new Map();
    for (const group of app.graph._groups) {
        const relationshipInfo = { nodes: [], childGroups: [], parentGroup: null };
        if (group._nodes) relationshipInfo.nodes.push(...group._nodes);
        if (group._children) {
            for (const child of group._children) {
                if (child instanceof window.LGraphGroup) relationshipInfo.childGroups.push(child);
            }
        }
        if (group.group) relationshipInfo.parentGroup = group.group;
        groupRelationships.set(group, relationshipInfo);
    }

    for (const group of app.graph._groups) {
        group._nodes = [];
        group._children = new Set();
    }

    for (const [group, rels] of groupRelationships) {
        for (const node of rels.nodes) {
            node.group = group;
            group._nodes.push(node);
            group._children.add(node);
        }
        for (const childGroup of rels.childGroups) {
            childGroup.group = group;
            group._children.add(childGroup);
        }
        if (rels.parentGroup) {
            group.group = rels.parentGroup;
            if (rels.parentGroup._children) {
                rels.parentGroup._children.add(group);
            }
        }
    }

    sortGroupsForRenderOrder();
    for (const group of app.graph._groups) {
        customRecomputeInsideNodes.call(group);
    }

    if (app.canvas) {
        app.canvas.setDirty(true, true);
    }
}

/**
 * 扫描并更新所有节点和组的关系
 */
export function scanAndUpdateRelationships() {
    if (!app.graph || !app.graph._groups) return;

    if (!state.hijackEnabled) {
        const allNodes = app.graph._nodes || [];
        for (const node of allNodes) node.group = null;
        for (const group of app.graph._groups) {
            group.group = null;
            group._nodes = [];
            group._children = new Set();
        }
        for (const group of app.graph._groups) {
            if (state.originalRecomputeInsideNodes) {
                state.originalRecomputeInsideNodes.call(group);
            }
        }
    } else {
        for (const group of app.graph._groups) {
            customRecomputeInsideNodes.call(group);
        }
        const allNodes = app.graph._nodes || [];
        for (const node of allNodes) {
            if (node.group) {
                if (!node.group._nodes.includes(node)) node.group._nodes.push(node);
                node.group._children.add(node);
            }
        }
        for (const group of app.graph._groups) {
            if (group.group) {
                group.group._children.add(group);
            }
        }
        sortGroupsForRenderOrder();
    }
    app.canvas.setDirty(true, true);
}

/**
 * 强制重新计算所有组关系
 * @param {boolean} forceOriginalMethod 是否使用原生方法
 */
export function forceRecalculateRelationships(forceOriginalMethod = false) {
    if (!app.graph) return;

    logger.debug("执行：强制重新计算组关系");

    // 如果指定使用原生方法，则使用原生的recomputeInsideNodes
    if (forceOriginalMethod && state.originalRecomputeInsideNodes) {
        for (const group of app.graph._groups) {
            state.originalRecomputeInsideNodes.call(group);
            // 强制更新组边界
            updateGroupBoundary(group, true, null, true);
        }
    } else {
        // 否则使用我们自己的方法
        rebuildAllGroupRelationships();
        // 强制更新所有组的边界
        for (const group of app.graph._groups) {
            updateGroupBoundary(group, true, null, true);
        }
    }

    // 更新渲染顺序并刷新画布
    sortGroupsForRenderOrder();
    app.canvas.setDirty(true, true);

    logger.debug("完成：强制重新计算组关系");
}

/**
 * 根据当前状态强制更新所有关系
 */
export function forceUpdateAllRelationships() {
    if (!app.graph) return;

    for (const group of app.graph._groups || []) {
        group._nodes = [];
        group._children = new Set();
    }
    for (const node of app.graph._nodes || []) {
        if (node.group && node.group instanceof window.LGraphGroup) {
            node.group._nodes.push(node);
            node.group._children.add(node);
        }
    }
    for (const group of app.graph._groups || []) {
        if (group.group && group.group instanceof window.LGraphGroup) {
            group.group._children.add(group);
        }
    }

    updateGroupRelationshipsByPosition();
}

/**
 * 根据空间位置关系更新组与节点的关系
 */
function updateGroupRelationshipsByPosition() {
    if (!app.graph) return;

    const sortedGroups = Array.from(app.graph._groups || []).sort((a, b) => {
        if (!a._bounding || !b._bounding) return 0;
        return (b._bounding[2] * b._bounding[3]) - (a._bounding[2] * a._bounding[3]);
    });

    for (const innerGroup of sortedGroups) {
        if (innerGroup.group) continue;
        for (const outerGroup of sortedGroups) {
            if (innerGroup === outerGroup || outerGroup._children.has(innerGroup)) continue;
            if (isGroupInsideGroup(innerGroup, outerGroup)) {
                innerGroup.group = outerGroup;
                outerGroup._children.add(innerGroup);
                break;
            }
        }
    }

    for (const node of app.graph._nodes || []) {
        if (node.group) continue;
        for (const group of sortedGroups) {
            if (isNodeInsideGroup(node, group)) {
                node.group = group;
                if (!group._nodes.includes(node)) group._nodes.push(node);
                group._children.add(node);
                break;
            }
        }
    }
}

/**
 * 重新计算选中对象的组关系
 * 这个函数专门用于处理选中对象的组关系重建，采用与全局重建相同的空间重叠计算逻辑
 */
export function recalculateSelectedItemsRelationships() {
    if (!app.graph || !state.hijackEnabled) {
        logger.warn("无法重新计算关系：功能未开启或图形不存在。");
        return;
    }

    logger.debug("执行：重新计算选中对象的组关系");

    const { selectedNodes, selectedGroups } = getCurrentSelection(true);

    if (selectedNodes.length === 0 && selectedGroups.length === 0) {
        logger.debug("完成：未发现选中的对象，无需计算组关系");
        return;
    }

    try {
        // 获取所有可能的父组，并过滤掉无效或已删除的组
        const allGroups = (app.graph._groups || []).filter(group =>
            group != null &&
            !group._isDeleted &&
            group._bounding != null &&
            group._pos != null &&
            group._size != null
        );

        if (allGroups.length === 0) {
            logger.debug("完成：没有可用的组，所有选中对象将保持独立");
            return;
        }

        // 记录需要更新的组
        const groupsToUpdate = new Set();

        // 1. 首先断开所有选中对象的现有关系
        for (const node of selectedNodes) {
            if (node?.group) {
                const oldGroup = node.group;
                if (oldGroup._nodes) oldGroup._nodes = oldGroup._nodes.filter(n => n !== node);
                if (oldGroup._children) oldGroup._children.delete(node);
                groupsToUpdate.add(oldGroup);
                node.group = null;
            }
        }
        for (const group of selectedGroups) {
            if (group?.group) {
                const oldParent = group.group;
                if (oldParent._children) oldParent._children.delete(group);
                groupsToUpdate.add(oldParent);
                group.group = null;
            }
        }

        // 2. 计算所有组的面积
        const groupAreas = new Map();
        for (const group of allGroups) {
            const area = group.size[0] * group.size[1];
            groupAreas.set(group, area);
        }

        // 3. 对所有可能的父组和选中的组进行排序
        const sortedAllGroups = [...allGroups].sort((a, b) => (groupAreas.get(b) || 0) - (groupAreas.get(a) || 0));
        const sortedSelectedGroups = [...selectedGroups].sort((a, b) => (groupAreas.get(b) || 0) - (groupAreas.get(a) || 0));


        // 4. 重建选中组之间的嵌套关系
        for (const innerGroup of sortedSelectedGroups) {
            if (!innerGroup || innerGroup._isDeleted) continue;

            // 找出所有可能包含这个组的外层组（可以是选中或未选中的）
            const containingGroups = [];
            for (const outerGroup of sortedAllGroups) {
                // 一个组不能是自己的父组
                if (innerGroup === outerGroup) continue;

                // 检查是否会导致循环引用
                let current = outerGroup.group;
                let wouldCreateCycle = false;
                while (current) {
                    if (current === innerGroup) {
                        wouldCreateCycle = true;
                        break;
                    }
                    current = current.group;
                }
                if (wouldCreateCycle) continue;

                // 检查空间位置关系
                if (isGroupInsideGroup(innerGroup, outerGroup)) {
                    containingGroups.push(outerGroup);
                }
            }

            // 如果有包含它的组，选择面积最小的那个作为父组
            if (containingGroups.length > 0) {
                containingGroups.sort((a, b) => (groupAreas.get(a) || 0) - (groupAreas.get(b) || 0));
                const parentGroup = containingGroups[0];
                innerGroup.group = parentGroup;
                parentGroup._children.add(innerGroup);
                groupsToUpdate.add(parentGroup);
            }
        }

        // 5. 重建选中节点与组的关系
        for (const node of selectedNodes) {
            if (!node) continue;

            const containingGroups = [];
            for (const group of sortedAllGroups) {
                if (isNodeInsideGroup(node, group)) {
                    containingGroups.push(group);
                }
            }

            if (containingGroups.length > 0) {
                containingGroups.sort((a, b) => (groupAreas.get(a) || 0) - (groupAreas.get(b) || 0));
                const parentGroup = containingGroups[0];
                node.group = parentGroup;
                if (!parentGroup._nodes.includes(node)) {
                    parentGroup._nodes.push(node);
                }
                parentGroup._children.add(node);
                groupsToUpdate.add(parentGroup);
            }
        }

        // 6. 更新所有受影响组的边界
        for (const group of groupsToUpdate) {
            if (group && !group._isDeleted) {
                updateGroupBoundary(group, true, null, true);
            }
        }

        // 7. 更新渲染顺序并刷新画布
        sortGroupsForRenderOrder();
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }

        logger.debug(`完成：已重新计算 ${selectedNodes.length} 个节点和 ${selectedGroups.length} 个组的关系`);
    } catch (error) {
        logger.error("重新计算选中对象组关系时出错:", error);
    }
}

/**
 * 劫持原生onGroup方法(Ctrl+G)
 * 以便使用自定义的逻辑来决定哪些节点和组应该被添加到新创建的组中
 */
function hijackOnGroup() {
    // 保存原始方法的引用
    const originalOnGroup = app.canvas.onGroup;

    // 重写onGroup方法
    app.canvas.onGroup = function (e) {
        // 如果功能未启用，直接使用原始方法
        if (!state.hijackEnabled || !app || !app.canvas) {
            try {
                return originalOnGroup.apply(this, arguments);
            } catch (error) {
                logger.error("调用原始onGroup方法时出错:", error);
                return null;
            }
        }

        // 当功能启用时，我们仍然调用原始的 onGroup 方法。
        // 这将利用 ComfyUI 的原生逻辑来创建组并根据当前选中的节点计算其初始边界。
        // 这样可以确保边界计算与原生行为一致。
        logger.debug("Ctrl+G触发，调用原生方法创建组并计算初始边界...");

        const group = originalOnGroup.apply(this, arguments);

        // 我们不再需要任何手动的关系指定或边界计算。
        // 在此之后，我们在 group_assistant.js 中设置的"标题编辑完成"监听器
        // 会自动触发 rebuildAllGroupRelationships 函数。
        // 该函数会完全重置并根据空间位置重新建立所有关系，包括正确的嵌套。

        if (group) {
            logger.debug("原生方法创建组成功。等待标题编辑完成后，将自动执行全局关系重建。");
        }

        return group; // 返回由原生方法创建的组
    };

    // 返回一个清理函数，用于恢复原始方法
    return () => {
        if (app && app.canvas) {
            app.canvas.onGroup = originalOnGroup;
        }
    };
}

/**
 * 处理父组被删除后的孤儿节点和组
 * 重新计算它们的组关系，如果有重叠的组，则将它们添加到重叠最多的组中
 * @param {Array<LGraphNode>} orphanedNodes - 被删除组的子节点
 * @param {Array<LGraphGroup>} orphanedGroups - 被删除组的子组
 */
export function handleOrphanedItems(orphanedNodes = [], orphanedGroups = []) {
    if (!app.graph || !state.hijackEnabled) return;

    logger.debug(`执行：处理 ${orphanedNodes.length} 个孤儿节点和 ${orphanedGroups.length} 个孤儿组`);

    // 过滤无效的节点和组
    orphanedNodes = orphanedNodes.filter(node => node != null);
    orphanedGroups = orphanedGroups.filter(group => group != null && !group._isDeleted);

    // 如果没有孤儿节点或组，直接返回
    if (orphanedNodes.length === 0 && orphanedGroups.length === 0) {
        logger.debug("完成：没有孤儿节点或组需要处理");
        return;
    }

    // 获取所有可能的父组，并过滤掉无效或已删除的组
    const allGroups = (app.graph._groups || []).filter(group =>
        group != null &&
        !group._isDeleted &&
        group._bounding != null &&
        group._pos != null &&
        group._size != null
    );

    if (allGroups.length === 0) {
        logger.debug("完成：没有可用的组，所有孤儿节点和组将保持独立");
        return;
    }

    try {
        // 计算每个组的面积，用于后续判断
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

        // 处理孤儿节点
        for (const node of orphanedNodes) {
            try {
                if (!node) continue;

                // 清除旧的组关系
                node.group = null;

                // 找出所有与节点重叠的组
                const overlappingGroups = [];
                for (const group of allGroups) {
                    try {
                        if (!group || group._isDeleted) continue;

                        const overlapResult = checkElementOverlap(node, group);
                        if (overlapResult && overlapResult.isOverlapping) {
                            // 计算嵌套深度
                            let depth = 0;
                            let parent = group.group;
                            let hasCircularRef = false;
                            const visited = new Set();

                            while (parent) {
                                if (visited.has(parent)) {
                                    hasCircularRef = true;
                                    break;
                                }
                                visited.add(parent);
                                depth++;
                                parent = parent.group;
                            }

                            if (hasCircularRef) continue;

                            // 根据深度和面积调整重叠比例
                            const depthFactor = Math.pow(0.5, depth);
                            const area = groupAreas.get(group) || 0;
                            const adjustedRatio = overlapResult.ratio * (1 + (1 - depthFactor));

                            overlappingGroups.push({
                                group,
                                ratio: adjustedRatio,
                                depth,
                                area
                            });
                        }
                    } catch (error) {
                        logger.error("检查节点与组重叠时出错:", error);
                        continue;
                    }
                }

                // 如果有重叠的组，选择最合适的一个
                if (overlappingGroups.length > 0) {
                    // 根据重叠比例、深度和面积排序
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

                    // 将节点添加到最合适的组中
                    const bestGroup = overlappingGroups[0].group;
                    if (bestGroup && !bestGroup._isDeleted) {
                        node.group = bestGroup;
                        if (!bestGroup._nodes) bestGroup._nodes = [];
                        if (!bestGroup._nodes.includes(node)) {
                            bestGroup._nodes.push(node);
                        }
                        if (!bestGroup._children) bestGroup._children = new Set();
                        bestGroup._children.add(node);

                        logger.debug(`节点 ${node.title || node.type || "未命名节点"} 已添加到组 ${bestGroup.title || "未命名组"}`);
                    }
                }
            } catch (error) {
                logger.error("处理孤儿节点时出错:", error);
                continue;
            }
        }

        // 处理孤儿组
        for (const group of orphanedGroups) {
            try {
                if (!group || group._isDeleted) continue;

                // 清除旧的组关系
                group.group = null;

                // 找出所有与组重叠的组
                const overlappingGroups = [];
                for (const potentialParent of allGroups) {
                    try {
                        // 跳过自身和无效组
                        if (!potentialParent || potentialParent === group || potentialParent._isDeleted) continue;

                        // 检查是否会导致循环引用
                        let currentParent = potentialParent.group;
                        let wouldCreateCycle = false;
                        const visited = new Set();

                        while (currentParent) {
                            if (visited.has(currentParent)) {
                                wouldCreateCycle = true;
                                break;
                            }
                            visited.add(currentParent);

                            if (currentParent === group) {
                                wouldCreateCycle = true;
                                break;
                            }
                            currentParent = currentParent.group;
                        }
                        if (wouldCreateCycle) continue;

                        // 检查重叠
                        const overlapResult = checkElementOverlap(group, potentialParent);
                        if (overlapResult && overlapResult.isOverlapping) {
                            // 计算嵌套深度
                            let depth = 0;
                            let parent = potentialParent.group;
                            const visitedForDepth = new Set();

                            while (parent) {
                                if (visitedForDepth.has(parent)) {
                                    break;
                                }
                                visitedForDepth.add(parent);
                                depth++;
                                parent = parent.group;
                            }

                            // 根据深度和面积调整重叠比例
                            const depthFactor = Math.pow(0.5, depth);
                            const area = groupAreas.get(potentialParent) || 0;
                            const adjustedRatio = overlapResult.ratio * (1 + (1 - depthFactor));

                            overlappingGroups.push({
                                group: potentialParent,
                                ratio: adjustedRatio,
                                depth,
                                area
                            });
                        }
                    } catch (error) {
                        logger.error("检查组与组重叠时出错:", error);
                        continue;
                    }
                }

                // 如果有重叠的组，选择最合适的一个
                if (overlappingGroups.length > 0) {
                    // 根据重叠比例、深度和面积排序
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

                    // 将组添加到最合适的父组中
                    const bestParentGroup = overlappingGroups[0].group;
                    if (bestParentGroup && !bestParentGroup._isDeleted) {
                        group.group = bestParentGroup;
                        if (!bestParentGroup._children) bestParentGroup._children = new Set();
                        bestParentGroup._children.add(group);

                        logger.debug(`组 ${group.title || "未命名组"} 已添加到父组 ${bestParentGroup.title || "未命名组"}`);
                    }
                }
            } catch (error) {
                logger.error("处理孤儿组时出错:", error);
                continue;
            }
        }

        // 更新渲染顺序
        try {
            sortGroupsForRenderOrder();
        } catch (error) {
            logger.error("更新渲染顺序时出错:", error);
        }

        // 刷新画布
        try {
            if (app.canvas) {
                app.canvas.setDirty(true, true);
            }
        } catch (error) {
            logger.error("刷新画布时出错:", error);
        }

        logger.debug("完成：孤儿节点和组的关系重新计算完成");
    } catch (error) {
        logger.error("处理孤儿项时出现未捕获的错误:", error);
    }
}

/**
 * 更新拖动节点后的组关系
 * @param {LGraphNode} node - 被拖动的节点
 */
function handleDraggedNodeRelations(node) {
    if (!node || !app.graph) return;

    try {
        logger.debug(`更新拖动节点关系: ${node.title || node.type || "未命名节点"}`);

        // 保存原始组引用
        const originalGroup = node.group;

        // 安全检查：确保原始组有效
        if (originalGroup && (originalGroup._isDeleted || !originalGroup._bounding)) {
            // 组无效，清除引用
            node.group = null;
            logger.debug(`检测到节点的无效组引用，已清除`);

            // 检查节点是否进入了其他组
            checkNodeNewGroupMembership(node);
        }
        // 检查节点是否仍在原来的组内
        else if (originalGroup && !isNodeInsideGroup(node, originalGroup)) {
            logger.debug(`节点不再位于原组内，移除关系`);

            // 从原组中移除节点
            if (originalGroup._nodes) {
                originalGroup._nodes = originalGroup._nodes.filter(n => n !== node);
            }
            if (originalGroup._children) {
                originalGroup._children.delete(node);
            }

            // 清除节点的组引用
            node.group = null;

            // 更新原组边界
            updateGroupBoundary(originalGroup, true);

            // 检查节点是否进入了其他组
            checkNodeNewGroupMembership(node);
        } else if (!originalGroup) {
            // 如果节点原本没有组，检查它是否进入了某个组
            checkNodeNewGroupMembership(node);
        } else {
            // 如果节点仍在原组内，更新组边界
            updateGroupBoundary(originalGroup, true);
        }

        // 确保Canvas更新
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    } catch (error) {
        logger.error("更新拖动节点关系时出错:", error);
    }
}

/**
 * 更新拖动组后的组关系
 * @param {LGraphGroup} group - 被拖动的组
 */
function handleDraggedGroupRelations(group) {
    if (!group || !app.graph) return;

    // 安全检查：确保组未被删除且有必要的属性
    if (group._isDeleted || !group._bounding || !group._pos || !group._size) {
        logger.warn("尝试更新已删除或无效组的关系，操作取消");
        return;
    }

    try {
        logger.debug(`更新拖动组关系: ${group.title || "未命名组"}`);

        // 保存原始父组引用
        const originalParent = group.group;

        // 安全检查：确保原始父组有效
        if (originalParent && (originalParent._isDeleted || !originalParent._bounding)) {
            // 父组无效，清除引用
            group.group = null;
            logger.debug(`检测到无效的父组引用，已清除`);

            // 检查组是否进入了其他组
            checkGroupNewParentMembership(group);
        }
        // 检查组是否仍在原来的父组内
        else if (originalParent && !isGroupInsideGroup(group, originalParent)) {
            logger.debug(`组不再位于原父组内，移除关系`);

            // 从原父组中移除
            if (originalParent._children) {
                originalParent._children.delete(group);
            }

            // 清除组的父组引用
            group.group = null;

            // 更新原父组边界
            updateGroupBoundary(originalParent, true);

            // 检查组是否进入了其他组
            checkGroupNewParentMembership(group);
        } else if (!originalParent) {
            // 如果组原本没有父组，检查它是否进入了某个组
            checkGroupNewParentMembership(group);
        } else {
            // 如果组仍在原父组内，更新父组边界
            updateGroupBoundary(originalParent, true);
        }

        // 更新当前组的边界
        updateGroupBoundary(group, false);

        // 确保Canvas更新
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    } catch (error) {
        logger.error("更新拖动组关系时出错:", error);
    }
}

/**
 * 更新调整大小后的组关系
 * @param {LGraphGroup} group - 被调整大小的组
 */
function handleResizedGroupRelations(group) {
    if (!group || !app.graph) return;

    // 安全检查：确保组未被删除且有必要的属性
    if (group._isDeleted) {
        logger.warn("尝试更新已删除组的关系，操作取消");
        return;
    }

    try {
        logger.debug(`更新调整大小组关系: ${group.title || "未命名组"}`);

        // 确保组有必要的属性
        if (!group._pos) group._pos = [0, 0];
        if (!group._size) group._size = [200, 100];

        // 更新组的_bounding属性以反映新尺寸
        if (!group._bounding) {
            group._bounding = [0, 0, 0, 0];
        }
        group._bounding[0] = group._pos[0];
        group._bounding[1] = group._pos[1];
        group._bounding[2] = group._size[0];
        group._bounding[3] = group._size[1];

        // 检查哪些节点现在在组内/组外
        const allNodes = app.graph._nodes || [];

        for (const node of allNodes) {
            if (!node) continue;

            // 如果节点已经在该组中
            if (node.group === group) {
                // 检查节点是否仍在组内
                if (!isNodeInsideGroup(node, group)) {
                    // 如果不在，移除关系
                    if (group._nodes) {
                        group._nodes = group._nodes.filter(n => n !== node);
                    }
                    if (group._children) {
                        group._children.delete(node);
                    }
                    node.group = null;

                    // 检查节点是否进入了其他组
                    checkNodeNewGroupMembership(node);
                }
            }
            // 如果节点不在任何组中，检查是否现在在该组内
            else if (!node.group && isNodeInsideGroup(node, group)) {
                // 添加到组
                node.group = group;
                if (!group._nodes.includes(node)) {
                    group._nodes.push(node);
                }
                group._children.add(node);
            }
        }

        // 检查哪些组现在在该组内/组外
        const allGroups = app.graph._groups || [];

        for (const otherGroup of allGroups) {
            if (!otherGroup || otherGroup === group || otherGroup._isDeleted) continue;

            try {
                // 避免循环引用
                let isDescendant = false;
                let parent = group.group;
                let visited = new Set();

                while (parent) {
                    if (visited.has(parent)) {
                        logger.warn("检测到循环引用，跳过组关系处理");
                        isDescendant = true;
                        break;
                    }

                    visited.add(parent);

                    if (parent === otherGroup) {
                        isDescendant = true;
                        break;
                    }
                    parent = parent.group;
                }
                if (isDescendant) continue;

                // 如果其他组已经是该组的子组
                if (otherGroup.group === group) {
                    // 检查是否仍在组内
                    if (!isGroupInsideGroup(otherGroup, group)) {
                        // 如果不在，移除关系
                        if (group._children) {
                            group._children.delete(otherGroup);
                        }
                        otherGroup.group = null;

                        // 检查是否进入了其他组
                        checkGroupNewParentMembership(otherGroup);
                    }
                }
                // 如果其他组不在任何组中，检查是否现在在该组内
                else if (!otherGroup.group && isGroupInsideGroup(otherGroup, group)) {
                    // 添加到组
                    otherGroup.group = group;
                    group._children.add(otherGroup);
                }
            } catch (error) {
                logger.error("处理组关系时出错:", error);
                continue;
            }
        }

        // 更新父组边界
        if (group.group && !group.group._isDeleted) {
            updateGroupBoundary(group.group, true);
        }

        // 更新渲染顺序
        sortGroupsForRenderOrder();

        // 确保Canvas更新
        if (app.canvas) {
            app.canvas.setDirty(true, true);
        }
    } catch (error) {
        logger.error("更新调整大小组关系时出错:", error);
    }
}

/**
 * 检查节点是否进入了新组
 * @param {LGraphNode} node - 要检查的节点
 */
function checkNodeNewGroupMembership(node) {
    if (!node || !app.graph) return;

    // 获取所有组
    const allGroups = app.graph._groups || [];
    if (allGroups.length === 0) return;

    // 寻找包含该节点的最小组
    let bestGroup = null;
    let bestArea = Infinity;

    for (const group of allGroups) {
        // 安全检查：确保组未被删除且有必要的属性
        if (!group || group._isDeleted || !group._bounding || !group._pos || !group._size) {
            continue;
        }

        try {
            if (isNodeInsideGroup(node, group)) {
                // 计算组面积
                const area = group.size[0] * group.size[1];
                if (area < bestArea) {
                    bestGroup = group;
                    bestArea = area;
                }
            }
        } catch (error) {
            logger.error("检查节点组关系时出错:", error);
            continue;
        }
    }

    // 如果找到包含节点的组，添加关系
    if (bestGroup) {
        logger.debug(i18n.t("log_node_enter_group", bestGroup.title || "未命名组"));
        node.group = bestGroup;
        if (!bestGroup._nodes.includes(node)) {
            bestGroup._nodes.push(node);
        }
        bestGroup._children.add(node);

        // 更新组边界
        updateGroupBoundary(bestGroup, true);
    }
}

/**
 * 检查组是否进入了新的父组
 * @param {LGraphGroup} group - 要检查的组
 */
function checkGroupNewParentMembership(group) {
    if (!group || !app.graph) return;

    // 安全检查：确保组未被删除且有必要的属性
    if (group._isDeleted || !group._bounding || !group._pos || !group._size) {
        logger.warn("尝试检查已删除或无效组的关系，操作取消");
        return;
    }

    // 获取所有组
    const allGroups = app.graph._groups || [];
    if (allGroups.length === 0) return;

    // 寻找包含该组的最小组
    let bestParent = null;
    let bestArea = Infinity;

    for (const potentialParent of allGroups) {
        // 安全检查：确保潜在父组未被删除且有必要的属性
        if (!potentialParent || potentialParent === group || potentialParent._isDeleted ||
            !potentialParent._bounding || !potentialParent._pos || !potentialParent._size) {
            continue;
        }

        try {
            // 检查是否会导致循环引用
            let isAncestor = false;
            let ancestor = potentialParent.group;
            let visited = new Set();

            while (ancestor) {
                if (visited.has(ancestor)) {
                    logger.warn("检测到循环引用，跳过组关系处理");
                    isAncestor = true;
                    break;
                }

                visited.add(ancestor);

                if (ancestor === group) {
                    isAncestor = true;
                    break;
                }
                ancestor = ancestor.group;
            }
            if (isAncestor) continue;

            // 检查是否在该组内
            if (isGroupInsideGroup(group, potentialParent)) {
                // 计算组面积
                const area = potentialParent.size[0] * potentialParent.size[1];
                if (area < bestArea) {
                    bestParent = potentialParent;
                    bestArea = area;
                }
            }
        } catch (error) {
            logger.error("检查组关系时出错:", error);
            continue;
        }
    }

    // 如果找到父组，添加关系
    if (bestParent) {
        logger.debug(i18n.t("log_group_enter_parent", bestParent.title || "未命名组"));
        group.group = bestParent;
        bestParent._children.add(group);

        // 更新父组边界
        updateGroupBoundary(bestParent, true);
    }
}

export {
    initGroupRelations,
    enableCustomGroupRelations,
    disableCustomGroupRelations,
    addNodeToGroup,
    removeNodeFromGroup,
    hijackOnGroup,
    handleDraggedNodeRelations as updateDraggedNodeRelationships,
    handleDraggedGroupRelations as updateDraggedGroupRelationships,
    handleResizedGroupRelations as updateResizedGroupRelationships
};