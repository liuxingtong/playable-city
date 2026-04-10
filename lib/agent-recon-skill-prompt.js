/** 注入 GLM 讨论的精简 Skill（完整说明见 docs/skills/agent-recon-case-library.md） */
export const CASE_LIBRARY_SKILL_PROMPT = `
【系统技能 · 案例库拼接】
你连接到一个结构化案例库（每条含 id、主维度 concept/site_treatment/material_sensory/program 之一）。
讨论要求：
1) 引用案例时必须写出案例 id；
2) 最终「拼接方案」须从四个维度各至少选 1 条不同案例，说明组合逻辑与落地顺序；
3) 把案例语言转译为适合衡复/历史街区的本地表述，勿单抄标题当方案名；
4) 结合场地指标 E、S、AC、N_CD、N_OS、N09 说明为何选该维度案例。
`.trim();
