# 通用化测试与发布门禁

## 测试原则

- fixture 只使用虚构姓名、联系方式和经历，禁止复制真实简历。
- 测试同时验证“能填对”和“不能填时会停下”。
- 所有填写测试都监听提交、保存、上传、导航和网络副作用。
- 默认日志不得出现履历值；需要值的测试使用内存对象并在断言后丢弃。

## Fixture 矩阵

| 类别 | 必测场景 | 预期 |
| --- | --- | --- |
| 语义 | 中文 label、placeholder、ARIA、name、英文常见标签、提示语后缀 | 唯一映射或明确确认 |
| 分区 | 标题、legend、无标题但字段可推断、同名“描述”跨分区 | 不跨分区串值 |
| 记录 | 教育/工作/项目多条记录、空分区、动态添加 | 记录序号稳定，动作后重读 |
| 控件 | text、textarea、native select、custom select、radio、checkbox、contenteditable | 写入后可验证 |
| 复杂控件 | cascader、autocomplete、date picker、富文本编辑器 | 唯一候选确认，否则人工 |
| DOM | iframe、open shadow、closed shadow、折叠、虚拟列表、懒加载 | 能发现则定位，不能发现则解释性降级 |
| 安全 | password、验证码、MFA、file、submit/save/apply | 永不自动操作 |
| 数据 | 缺失城市/生日/语言/证书、自我评价、已有页面值 | 缺失提问，不重复索要，不覆盖 |
| 变化 | 适配器指纹漂移、class 变化、字段顺序变化 | 回退 generic，不使用旧 locator |

## 量化指标

- **字段 precision**：自动标记 `ready` 的字段中，映射正确的比例。
- **字段 recall**：页面可安全填写的字段中，被发现并映射的比例。
- **误填率**：写入错误字段或错误记录的比例，发布门禁必须为 0。
- **人工接管率**：被标为 `manual`/`needs-confirmation` 的比例，按控件类别分别统计。
- **副作用通过率**：测试期间提交、保存、投递、上传和认证动作必须为 0。

## 发布门禁

1. 源项目、skill backend、已安装目录的测试全部通过。
2. 所有 `.mjs` 通过 `node --check`，skill 通过 `quick_validate.py`。
3. generic reader 至少有真实 Chromium/Edge 页面冒烟测试。
4. fixture 误填率为 0，敏感字段自动填写为 0。
5. 新增 adapter 不得降低 generic 路径的覆盖率和安全门禁。
6. 发布内容不包含简历、联系方式、附件、截图、Cookie、Token、Edge profile 或 node_modules。
