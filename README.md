# Resume Form Filler

招聘官网履历填写 Skill，面向 Codex、WorkBuddy 等本地 Agent。它将用户明确提供的简历解析为可复用 JSON，通过结构适配器读取招聘表单，在用户确认后填写字段，并在首轮后主动收集真正缺失的信息。

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

## 安全边界

- 不自动提交、保存或投递申请。
- 不上传简历、照片或其他附件。
- 不填写密码、验证码、短信或 MFA。
- 向招聘网站输入任何履历资料前再次确认目标网站和具体字段。
- 缺失信息不会被编造；新增回答先写入新的 `draft` JSON 并重新确认。

仓库不包含真实简历、联系方式、Cookie、Token、浏览器配置或测试账号数据。详细流程见 [SKILL.md](SKILL.md)。
