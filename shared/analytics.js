export const ANALYTICS_FEATURES = Object.freeze([
  {
    key: "difficulty",
    name: "难度通关率",
    description: "按难度对比选择人数、通关人数、选择次数、通关次数及通关率。",
  },
  {
    key: "choices",
    name: "选项选择统计",
    description: "比较候选出现与实际选择，适用于技能、装备、路线等选择。",
  },
  {
    key: "stages",
    name: "阶段退出统计",
    description: "按地图定义的阶段统计进入、完成、失败与主动退出。",
  },
]);
export const ANALYTICS_KEYS = ANALYTICS_FEATURES.map((feature) => feature.key);
