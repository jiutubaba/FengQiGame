export const ANALYTICS_FEATURES = Object.freeze([
  {
    key: "progression",
    name: "关卡表现",
    description: "按关卡或难度统计参与、通关、失败与耗时。",
  },
  {
    key: "choices",
    name: "选择偏好",
    description: "比较候选出现与实际选择，适用于技能、装备、路线等选择。",
  },
  {
    key: "challenges",
    name: "挑战表现",
    description: "统计挑战结果、失败原因、耗时和失败时剩余目标进度。",
  },
  {
    key: "stages",
    name: "阶段流失",
    description: "统计各阶段的到达、完成、明确退出与未结算。",
  },
]);
export const ANALYTICS_KEYS = ANALYTICS_FEATURES.map((feature) => feature.key);
