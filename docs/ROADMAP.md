# 通用化路线图

优先级定义：P0 为安全或基础阻塞项，P1 为提高通用覆盖率的核心项，P2 为增强项，P3
为生态和长期工程化。每项完成后都必须通过 [TEST_PLAN.md](TEST_PLAN.md) 的发布门禁。

## Milestone M0：当前基线（已完成）

- [x] 无适配器时自动 generic discovery。
- [x] `--generic` 强制绕过适配器。
- [x] 分区、标签、控件类型、重复记录和当前 DOM locator 发现。
- [x] 低置信度、动态添加、日期、附件、敏感字段的安全状态。
- [x] 缺失字段问题生成与新 draft 回写。
- [x] mapper、reader smoke、skill validation 测试。

## Milestone M1：DOM 覆盖率（P0）

### M1.1 Frame walker

- 目标：遍历同源和可访问的跨 frame 页面，输出 `framePath`，每个 locator 带 frame 上下文。
- 设计：只读阶段枚举 frame；填写阶段逐 frame 再确认；跨域 frame 访问失败时记录原因。
- 验收：主文档 + 同源 iframe 的字段召回率 >= 95%；跨域不可访问时不崩溃、不误填。

### M1.2 Open shadow discovery

- 目标：支持 open shadow root 和 Playwright piercing locator；closed root 明确报告不可访问。
- 验收：open shadow fixture 可读取和填写；closed shadow fixture 只输出人工接管。

### M1.3 Visibility and state model

- 目标：区分可见、折叠、禁用、只读、虚拟化、需滚动和需用户展开。
- 验收：预览不产生添加/保存副作用；状态原因可解释；不把隐藏字段当作已确认字段。

## Milestone M2：控件和动态协议（P1）

### M2.1 控件策略注册表

- 目标：统一 `text/native-select/custom-select/autocomplete/cascader/date/rich-text/radio/checkbox` 策略。
- 每个策略必须有：发现条件、候选值读取、填写动作、填写后验证、失败回退。
- 验收：任何策略失败都变成 `manual` 或 `needs-confirmation`，不静默继续。

### M2.2 级联和联想控件

- 目标：读取可见选项和依赖关系，只有唯一候选或用户确认时选择。
- 验收：省/市/区和学校/专业 fixture 不跨字段串值；多候选时列出候选而不是猜。

### M2.3 日期和富文本

- 目标：支持明确格式的日期、日期范围和 contenteditable/rich-text；保留格式化前后值。
- 验收：不从年龄推生日；不丢失项目/实习多段描述；日期格式不改变原意。

### M2.4 动态 section protocol

- 目标：识别新增、折叠、复制模板和记录计数，动作后重新读取并废弃旧 locator。
- 验收：只增加 JSON 所需空白记录；不点击删除/保存；新增失败时停止并报告。

## Milestone M3：语义泛化（P1）

### M3.1 字段本体和别名版本

- 目标：将标签映射拆成 canonical field、同义词、语言、控件约束和敏感等级。
- 验收：中英文常见标签、同义词和带提示语标签覆盖率 >= 95%；版本变更有回归测试。

### M3.2 结构 + 语义联合置信度

- 目标：综合标签来源、分区、记录上下文、控件类型、候选唯一性和简历值类型计算置信度。
- 验收：定义 `ready` 阈值和校准集；无法达到阈值时不自动填写。

### M3.3 模型辅助映射（可选、本地优先）

- 目标：对词典未覆盖字段生成候选路径和解释，不直接执行填写。
- 约束：默认只发送脱敏结构元数据；用户确认后才允许使用真实值；候选必须可审计。
- 验收：模型不可用时系统仍可运行；模型输出不改变安全状态机。

## Milestone M4：视觉 fallback（P2）

- 目标：对 DOM 语义缺失页面生成截图/OCR 候选区域，仅用于人工确认和定位辅助。
- 约束：不默认使用坐标盲填；坐标动作需要逐字段确认，并在写入后截图复核。
- 验收：视觉误识别只会导致候选被拒绝或人工处理，不会扩大自动填写范围。

## Milestone M5：评测与工程化（P2/P3）

- 目标：建立匿名 HTML fixture、浏览器版本矩阵、站点变化回归和安全审计。
- 指标：字段 precision/recall、误填率、覆盖率、人工接管率、动态记录成功率、无副作用通过率。
- 发布门禁：误填率为 0；敏感控件自动填写为 0；提交/保存/上传动作测试为 0；所有 P0 回归通过。

## Milestone M6：插件和生态（P3）

- 目标：提供与 Agent 宿主解耦的 `discover -> propose -> confirm -> fill -> verify` API。
- 设计：能力协商、事件日志、可取消、超时、版本化 schema、宿主注入浏览器会话。
- 验收：Codex 和 WorkBuddy 可复用同一 backend；宿主差异不要求复制站点适配器。
