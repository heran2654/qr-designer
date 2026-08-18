# Third-party notices

本项目在浏览器本地加载以下开源组件：

- `qrcode-generator` 1.4.4，Kazuhiko Arase，MIT License，来源：https://github.com/kazuhikoarase/qrcode-generator
- `jsQR` 1.4.0，Cozmo，Apache License 2.0，来源：https://github.com/cozmo/jsQR
- `@zxing/browser` 0.2.1，ZXing for JS contributors，MIT License，来源：https://github.com/zxing-js/browser

对应许可文本保存在 `vendor/` 目录。组件仅用于本地编码和解码，应用不向外部服务发送二维码内容。

`vendor/qrcode.js` 增加了一个很小的本地扩展，用于在原库已有的 8 个标准 Mask Pattern 之间进行 Logo-aware 选择；编码和纠错算法未被替换。
