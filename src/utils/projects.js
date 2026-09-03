export const PROJECT_PLATFORMS = Object.freeze([
  {
    value: "kk",
    label: "KK平台",
    description: "KK 对战平台项目",
  },
  {
    value: "oasis_qiyuan",
    label: "绿洲启元",
    description: "绿洲启元平台项目",
  },
]);

export const FEEDBACK_DIMENSIONS = Object.freeze([
  { key: "onboarding", label: "上手难易" },
  { key: "visuals", label: "游戏画面" },
  { key: "gameplay", label: "游戏玩法" },
  { key: "rewards", label: "等级奖励" },
  { key: "progression", label: "存档养成" },
]);

export function projectPlatform(value) {
  return PROJECT_PLATFORMS.find((platform) => platform.value === value);
}
