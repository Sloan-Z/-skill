# 项目协作约束

这是通用招聘官网简历填写项目的工程与项目管理目录，不是个人简历工作目录。

## 目录边界

- 只在本目录维护公开源码、测试、skill、架构决策和路线图。
- 不复制或读取 `D:\Job\Resume` 中的个人简历、PDF、截图、联系方式、Cookie、Token、Edge profile 或运行缓存到本目录。
- 测试只能使用虚构履历 fixture；日志默认不输出真实值。

## 工作方式

- 通用 discovery 是默认路径，站点 adapter 只是可选结构缓存。
- 先做只读发现和映射，再进行逐字段用户确认；不得自动提交、保存、投递、上传或处理验证码/MFA。
- 适配器指纹失效时必须回退 generic discovery，不得继续使用旧 locator。
- 任何新能力都要同步更新 [PROJECT_MANAGEMENT.md](PROJECT_MANAGEMENT.md)、[docs/ROADMAP.md](docs/ROADMAP.md) 和 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)，并补充自动化测试或明确记录测试缺口。

## 发布前

运行 `backend` 测试、`node --check`、skill 校验和安全内容检查；详细门禁见 [docs/TEST_PLAN.md](docs/TEST_PLAN.md)。
