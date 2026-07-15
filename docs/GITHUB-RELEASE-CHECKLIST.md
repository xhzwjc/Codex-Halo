# GitHub 发布与分享清单

## 需要提前安装或准备什么

本机 Windows 不需要安装 macOS 构建工具，也不能直接构建 macOS 安装包。macOS 包由 GitHub Actions 的 `macos-latest` runner 构建。

本机需要：

- Git
- Node.js 20+
- Rust stable
- npm 依赖已安装

GitHub 需要：

- 一个 GitHub 仓库
- GitHub Actions 已启用
- 代码已推送到默认分支

macOS Universal 构建需要的 Rust targets 已经在 CI/release workflow 中自动安装：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

你不需要在 Windows 本机安装这两个 target。

## 第一次上传到 GitHub

如果本地仓库还没有 remote，先在 GitHub 创建一个空仓库，然后执行：

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git branch -M main
git add .
git commit -m "Prepare Windows and macOS unsigned release"
git push -u origin main
```

如果已经有 remote，只需要：

```bash
git add .
git commit -m "Prepare Windows and macOS unsigned release"
git push origin main
```

## 生成可分享版本

确保功能代码已经提交、当前位于干净的 `main` 后，使用一条命令发布：

```bash
npm run release -- 0.2.2
```

脚本会完成五处版本同步、前端和 Rust 检查、release commit、annotated tag 以及 `main` 和 tag 的原子推送；如果版本已经同步，则直接标记当前干净提交。只想预检时执行 `npm run release -- 0.2.2 --dry-run`。tag 推送后会自动触发 release workflow，不需要再逐条输入 Git 命令。

构建完成后，到 GitHub 仓库的 Releases 页面检查公开 Release。附件应包含：

- `Codex Halo_<version>_x64-setup.exe`
- `Codex Halo_<version>_x64_en-US.msi`
- `Codex Halo_<version>_universal.dmg`

当前 workflow 会在两个平台构建全部成功后，由单独的 publish job 一次性创建公开 Release，并直接上传原生安装包。确认附件与自动生成说明无误后，把 Release 链接发给用户；如需先审核，请把 workflow 的 `draft` 改为 `true`。Releases 页面自动出现的 Source code ZIP/TAR 是 GitHub 生成的源码归档，不是安装包。

## 发给 Mac 用户时的说明

当前 macOS 包是 unsigned 包。用户首次打开可能会被 Gatekeeper 拦截，可以这样打开：

1. 下载并打开 `Codex Halo_<version>_universal.dmg`。
2. 把 Codex Halo 拖到 Applications。
3. 右键点击应用，选择 Open。
4. 在系统提示里再次选择 Open。
5. 如果仍被拦截，到 System Settings -> Privacy & Security 里允许打开。

## 以后公开分发还需要什么

如果要面向非技术用户公开分发，建议补：

- Windows 代码签名证书。
- Apple Developer ID Application 证书。
- Apple Team ID。
- Apple app-specific password。
- GitHub Secrets 中的签名和公证配置。

这些账号、证书和密码不能由代码生成，需要项目所有者申请或购买。
