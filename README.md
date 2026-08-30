# Resume Form Filler

面向 Codex、WorkBuddy 等本地 Agent 的中国企业招聘官网简历填写 Skill。它将用户明确提供的简历解析为可复用 JSON，通过通用发现读取陌生招聘表单，在用户确认后填写字段，并在首轮后主动收集真正缺失的信息。站点适配器只是可选的结构缓存。

## 安装

```powershell
git clone https://github.com/Sloan-Z/-skill.git "$env:USERPROFILE\.codex\skills\resume-form-filler"
npm install --prefix "$env:USERPROFILE\.codex\skills\resume-form-filler\backend"
```

重新打开 Codex 后，可直接说：

```text
使用 resume-form-filler 解析我的简历并准备招聘官网填写预览。
```

WorkBuddy 或其他 Agent 可加载根目录的 `SKILL.md`，并调用 `backend/scripts` 下的 Node 后端。

项目管理材料：

- [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)：当前能力、边界、风险和量化目标
- [docs/ROADMAP.md](docs/ROADMAP.md)：分阶段实现规划
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md)：测试矩阵与发布门禁
- [docs/DECISIONS.md](docs/DECISIONS.md)：关键架构决策

未收录的网站无需先添加适配器。直接运行通用预览即可：

```powershell
node "$env:USERPROFILE\.codex\skills\resume-form-filler\backend\scripts\read-form.mjs" --generic
node "$env:USERPROFILE\.codex\skills\resume-form-filler\backend\scripts\map-resume.mjs" --resume "D:\Job\Resume\resume.json" --url "https://example.com/resume" --generic
```

通用发现会从可见控件的标签、ARIA 属性、placeholder、标题、重复记录和控件类型推断字段，
并为映射给出置信度。低置信度、日期、附件、复杂下拉和动态新增会要求确认或保留人工处理；
跨域 iframe、shadow DOM、无语义自绘控件和反自动化页面不保证完全自动化。

## 安全边界

- 不自动提交、保存或投递申请。
- 不上传简历、照片或其他附件。
- 不填写密码、验证码、短信或 MFA。
- 向招聘网站输入任何履历资料前再次确认目标网站和具体字段。
- 缺失信息不会被编造；新增回答先写入新的 `draft` JSON 并重新确认。

仓库不包含真实简历、联系方式、Cookie、Token、浏览器配置或测试账号数据。详细流程见 [SKILL.md](SKILL.md)。
