# Esports Manager 2026 EMDB Tools & Local Editer

[English](#english) · [简体中文](#简体中文)

An unofficial, local-first toolkit for decrypting, editing, and encrypting
`Esports Manager 2026` EMDB databases. The project contains two cooperating
applications:

- **EMDB Tool** decrypts and encrypts the game database container.
- **EMDB Local Editer** opens the decrypted ZIP in a bilingual browser editor.

The complete workflow is local:

```text
.emdb → EMDB Tool decrypt → decrypted.zip → Local Editer
      → edited.zip → EMDB Tool encrypt → custom.emdb
```

> This project is not affiliated with, endorsed by, or supported by Neurona
> Games, indie.io, Steam, or Valve. Only inspect or modify files you are
> authorized to use, and always keep an untouched backup.

---

## English

### Components

#### EMDB Tool

A Windows GUI and Python CLI that:

- Decrypts `.emdb` files into a CRC-validated ZIP and extracted CSV directory.
- Encrypts an existing ZIP or CSV directory into a game-compatible EMDB v3 file.
- Automatically discovers Steam libraries and the `Esports Manager 2026` install.
- Recovers AES-128/192/256 hexadecimal key literals from `global-metadata.dat`.
- Generates a fresh random 12-byte nonce for every AES-GCM encryption.
- Validates the authentication tag and performs a full read-back check.
- Makes no network requests and does not launch or inject into the game process.

#### EMDB Local Editer

A local browser workbench that:

- Opens only a ZIP explicitly selected by the user; samples are never auto-loaded.
- Edits Players, Staff, Teams, Sponsors, Tournaments, and roster order.
- Supports complete **Simplified Chinese / English** interface switching.
- Provides searchable tables, all-field editing, validation, undo, and redo.
- Lets every dropdown be searched by typing a keyword.
- Provides countries, cities, roles, player positions, sponsor categories, maps,
  and cross-table team/player relationships.
- Requires a tournament country before its city is enabled and only accepts a
  city belonging to that country.
- Creates blank records or copies an existing record with a new identifier.
- Automatically attempts to load HTTP(S) image fields and shows a thumbnail,
  loading state, failure state, and original-image link.
- Shows game custom-asset paths, generated PNG names, and recommended sizes.
- Preserves unrelated ZIP entries and exports a new `_edited.zip` archive.
- Parses and repacks ZIP data in browser memory without uploading the database.

### Project layout

```text
EMDB_Tool.exe         Packaged Windows EMDB Tool
decrypt_emdb.py       Python GUI, CLI, encryption, and decryption source
requirements.txt      Python source dependency list
Start_EMDB_Editor.js  Node.js launcher for EMDB Local Editer
web-editor/           Local editor source, dependencies, and tests
samples/              Example encrypted database and decrypted ZIP
README.md             Combined Tool and Editer documentation
LICENSE               Project license
```

### Quick workflow

1. Double-click `EMDB_Tool.exe` and choose **Decrypt EMDB**.
2. Select the source `.emdb` and an output directory.
3. Run `npm start` in this project directory.
4. Open `http://localhost:3000/` and click **Upload ZIP**.
5. Edit the database and click **Export ZIP**.
6. In EMDB Tool, choose **Encrypt CSV / ZIP** and select the edited ZIP.
7. Keep the original database as a backup before using the custom file.

## EMDB Tool

### Packaged application

```text
EMDB_Tool.exe
```

Double-click it to open the GUI. It is self-contained and does not require
Python. Use the selector in the upper-right corner to switch between English
and Simplified Chinese.

Because a locally built executable may not be code-signed, Windows SmartScreen
can display a warning. Verify the file source and SHA-256 hash before running it.

### Decrypt an EMDB

1. Click **Decrypt EMDB**.
2. Select the `.emdb` file.
3. Select an output directory.
4. The tool finds the installed game metadata, recovers candidate keys, and
   accepts a key only when the payload is a valid ZIP and all CRC checks pass.
5. Successful output contains:

   ```text
   <database-name>_decrypted.zip
   <database-name>_csv/
   ```

### Encrypt CSV or ZIP

1. Click **Encrypt CSV / ZIP**.
2. Choose an existing ZIP or a directory containing CSV files.
3. Select the output `.emdb` path.
4. The tool recovers the current key, packages the data when necessary,
   encrypts it, and validates the result.

When a directory is selected, the tool recursively includes `*.csv` and the
optional `roster_order.json`. At least one CSV file is required.

### Command-line usage

Requirements:

```powershell
python -m pip install -r requirements.txt
```

Decrypt:

```powershell
python .\decrypt_emdb.py decrypt database.emdb
```

Encrypt a CSV directory:

```powershell
python .\decrypt_emdb.py encrypt database_csv --output custom_database.emdb
```

Encrypt an existing ZIP:

```powershell
python .\decrypt_emdb.py encrypt database_decrypted.zip --output custom_database.emdb
```

Useful options:

```text
--game-dir PATH         Explicit game installation directory
--metadata PATH         Explicit global-metadata.dat path
--key HEX               Use a known 128/192/256-bit AES key
--reference-emdb PATH   Identify the correct key from multiple candidates
--version NUMBER        EMDB version byte (default: 3)
--force                 Overwrite an existing encryption output
```

### EMDB container format

```text
Offset  Size       Description
0       4          ASCII magic: EMDB
4       1          Format version
5       12         AES-GCM nonce
17      variable   AES-GCM ciphertext; plaintext is a ZIP archive
EOF-16  16         AES-GCM authentication tag
```

Encryption defaults to format version `3`. Game code observed during
development supports versions `2` and `3`.

### Build the EXE

Requirements: Python 3.10+, Tkinter, `cryptography`, and PyInstaller.

```powershell
python -m pip install -r requirements.txt
python -m pip install pyinstaller
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --windowed `
  --name EMDB_Tool `
  .\decrypt_emdb.py
```

The result is written to `dist\EMDB_Tool.exe`.

## EMDB Local Editer

### Requirements and launch

- Windows 10 or Windows 11.
- Node.js `22.13.0` or newer.
- A decrypted EMDB ZIP.

Run from the project root:

```powershell
npm start
```

Equivalent direct command:

```powershell
node .\Start_EMDB_Editor.js
```

The first launch installs missing local web dependencies. Then open:

```text
http://localhost:3000/
```

Keep the terminal open. Press `Ctrl+C` to stop the editor. To check the runtime
without starting the server:

```powershell
node .\Start_EMDB_Editor.js --check
```

### Supported ZIP files

The selected archive must contain these files at its root or in a common
subdirectory:

```text
Players.csv
Staff.csv
Teams.csv
Sponsors.csv
Tournaments.csv
roster_order.json
```

CSV files use a semicolon delimiter. Existing field order and unrelated ZIP
members are preserved.

### Searchable fields and relationships

Fields with predefined or related values use searchable combination inputs.
Click the field and type any part of a country, role, position, sponsor type,
team, player, map, or other option to narrow the list. Existing custom values
remain editable.

Relationships include:

- `Players.Team`, `Staff.Team`, and roster teams → `Teams.Nick`.
- Team academy → teams.
- Starting IGL and roster player → players.
- Tournament country → only the configured cities in that country.

Tournament city stays disabled until a country is selected. Changing the
country clears a city that no longer matches; an unmatched city is cleared when
the field loses focus and is also reported by validation.

### Network image preview

When an HTTP(S) image address appears in an image-related field such as
`PhotoUrl`, or the URL ends in a common image extension, the editor automatically
requests it and displays a thumbnail. The preview uses lazy loading and does not
embed the image into the exported ZIP.

Important privacy note: loading a remote image sends a normal browser image
request to that URL. The remote host can see ordinary request information such
as the user's IP address. The database ZIP itself is still never uploaded.
Hotlink protection, expired URLs, offline hosts, or invalid certificates can
cause the preview to fail; the original URL remains editable.

### Game custom images

The editor generates the expected PNG name and shows these directories:

```text
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Players
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Teams
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Staffs
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Sponsors
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Tournaments
```

Player and staff files use `Internal ID`; team and tournament files use the
full name; sponsor files use the sponsor number.

### Development and tests

From `web-editor/`:

```powershell
npm run dev
npm run build
npm test
```

Tests cover the production build, rendered editor shell, country/city catalog,
searchable inputs, bilingual UI, network-image preview, nested ZIP discovery,
and unrelated-entry preservation.

### Troubleshooting

#### Game metadata cannot be found

Confirm that Steam and the game are installed locally. For the Python CLI, pass
`--game-dir` or `--metadata` explicitly.

#### No matching key was found

The database may be from an older game build. Use that build's
`global-metadata.dat` or pass a previously saved key with `--key`.

#### The game rejects an encrypted database

- Confirm the archive contains the expected CSV names and headers.
- Use metadata from the installed game build.
- Preserve semicolon delimiters, encoding, identifiers, and required columns.
- Correct validation warnings for relationships required by the game.

#### The editor rejects the ZIP

Upload the decrypted `.zip`, not the encrypted `.emdb`, and confirm all six
required database files exist.

#### A remote thumbnail does not load

Check the URL in a normal browser tab. The host may block third-party image
requests or require authentication. This does not prevent editing or exporting.

### Privacy, safety, and limitations

- EMDB encryption/decryption and ZIP editing are local.
- The Tool makes no network requests.
- The Editer requests only image URLs present in image fields for thumbnail preview.
- Neither application reads Steam passwords, browser sessions, or login tokens.
- Neither application launches, injects into, or modifies the running game process.
- ZIP paths are validated before extraction by the Tool.
- Export creates a new file instead of overwriting the source database.
- Validation detects known structural and relationship issues but cannot
  guarantee semantic compatibility with every game update.
- Future game versions may change the container, key representation, fields,
  allowed values, or image paths.

---

## 简体中文

### 项目组成

这是一个非官方、本地优先的 `Esports Manager 2026` EMDB 数据库工具套件：

- **EMDB Tool**：负责解密和重新加密游戏数据库。
- **EMDB Local Editer**：在浏览器中编辑解密后的 ZIP，支持中英文切换。

完整流程：

```text
.emdb → EMDB Tool 解密 → decrypted.zip → Local Editer
      → edited.zip → EMDB Tool 加密 → custom.emdb
```

本项目与 Neurona Games、indie.io、Steam 或 Valve 无关。请仅处理你有权使用的
文件，并始终保留未经修改的原始数据库备份。

### 主要功能

#### EMDB Tool

- 将 `.emdb` 解密为经过 CRC 校验的 ZIP 和 CSV 目录。
- 将 CSV 目录或现有 ZIP 加密为游戏兼容的 EMDB v3。
- 自动查找 Steam 库、游戏安装目录和 `global-metadata.dat`。
- 自动恢复 AES-128/192/256 十六进制密钥候选。
- 每次加密生成新的随机 12 字节 nonce。
- 校验 AES-GCM 标签并执行完整回读验证。
- 不联网、不启动游戏，也不注入游戏进程。

#### EMDB Local Editer

- 只打开用户主动选择的 ZIP，不会自动加载示例数据库。
- 编辑选手、员工、战队、赞助商、锦标赛和阵容顺序。
- 完整支持简体中文和英语界面切换。
- 支持搜索、全部字段编辑、校验、撤销和重做。
- 所有下拉选项都可以输入关键字进行匹配。
- 国家、地区、职务、选手定位、赞助商类型、地图、战队和选手关联可直接选择。
- 锦标赛必须先选择国家，地区只能使用属于该国家的城市。
- 可以创建空白记录或复制现有记录，并生成不冲突的标识。
- 网络图片字段会自动尝试加载，显示缩略图、加载状态、失败提示和原图链接。
- 显示游戏自定义图片目录、自动文件名和推荐尺寸。
- 保留 ZIP 内无关文件，并导出新的 `_edited.zip`。
- 数据库 ZIP 只在浏览器内存中解析和重新打包，不会上传。

### 项目目录

```text
EMDB_Tool.exe         Windows 打包版 EMDB Tool
decrypt_emdb.py       Python 图形界面、命令行、加密与解密源码
requirements.txt      Python 源码依赖列表
Start_EMDB_Editor.js  EMDB Local Editer 的 Node.js 启动器
web-editor/           编辑器源码、依赖和测试
samples/              加密数据库和解密 ZIP 示例
README.md             Tool 与 Editer 的合并说明
LICENSE               项目许可证
```

## EMDB Tool 使用方法

### 图形界面

双击 `EMDB_Tool.exe`。右上角可以切换简体中文和英语。

#### 解密

1. 点击“解密 EMDB”。
2. 选择 `.emdb` 文件。
3. 选择输出目录。
4. 工具自动查找元数据、测试密钥并验证 ZIP 与 CRC。
5. 成功后生成：

   ```text
   <数据库名>_decrypted.zip
   <数据库名>_csv/
   ```

#### 加密

1. 点击“加密 CSV / ZIP”。
2. 选择现有 ZIP，或选择包含 CSV 的目录。
3. 指定输出 `.emdb` 路径。
4. 工具获取当前密钥、打包、加密并回读验证。

选择目录时只递归加入 `*.csv` 和可选的 `roster_order.json`，至少需要一个 CSV。

### 命令行

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

解密：

```powershell
python .\decrypt_emdb.py decrypt database.emdb
```

加密 CSV 目录：

```powershell
python .\decrypt_emdb.py encrypt database_csv --output custom_database.emdb
```

加密现有 ZIP：

```powershell
python .\decrypt_emdb.py encrypt database_decrypted.zip --output custom_database.emdb
```

常用参数：

```text
--game-dir PATH         手动指定游戏目录
--metadata PATH         手动指定 global-metadata.dat
--key HEX               手动指定 AES 密钥
--reference-emdb PATH   密钥候选不唯一时使用的参考数据库
--version NUMBER        加密格式版本，默认 3
--force                 覆盖已经存在的输出文件
```

### EMDB 容器结构

```text
偏移    长度       内容
0       4          ASCII 标识：EMDB
4       1          格式版本
5       12         AES-GCM nonce
17      可变       AES-GCM 密文；明文为 ZIP
末尾-16 16         AES-GCM 验证标签
```

默认加密版本为 `3`，开发期间观察到游戏代码支持版本 `2` 和 `3`。

### 编译 EXE

```powershell
python -m pip install -r requirements.txt
python -m pip install pyinstaller
python -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name EMDB_Tool .\decrypt_emdb.py
```

生成文件位于 `dist\EMDB_Tool.exe`。

## EMDB Local Editer 使用方法

### 运行要求与启动

- Windows 10 或 Windows 11。
- Node.js `22.13.0` 或更高版本。
- 已解密的 EMDB ZIP。

在项目根目录运行：

```powershell
npm start
```

也可以运行：

```powershell
node .\Start_EMDB_Editor.js
```

首次启动会安装缺失的本地网页依赖。启动后打开：

```text
http://localhost:3000/
```

保持终端开启，按 `Ctrl+C` 停止。只检查环境、不启动服务：

```powershell
node .\Start_EMDB_Editor.js --check
```

### 编辑流程

1. 使用 EMDB Tool 解密 `.emdb`。
2. 启动 Local Editer，点击“上传 ZIP”。
3. 选择生成的 `<数据库名>_decrypted.zip`。
4. 选择数据表，搜索并编辑记录。
5. 使用“新建”创建空白记录，或使用“复制为新记录”作为模板。
6. 点击“导出 ZIP”，下载 `<原文件名>_edited.zip`。
7. 使用 EMDB Tool 将编辑后的 ZIP 重新加密。

`samples/` 中的文件不会被自动打开。

### ZIP 要求

ZIP 根目录或同一个子目录内必须包含：

```text
Players.csv
Staff.csv
Teams.csv
Sponsors.csv
Tournaments.csv
roster_order.json
```

CSV 使用分号分隔。编辑器会保持字段顺序，并保留 ZIP 内其他文件。

### 可搜索下拉与数据关联

具有固定选项或关联数据的字段使用可搜索组合框。点击字段后输入国家、职务、定位、
赞助商类型、战队、选手或地图名称中的任意关键字，即可缩小匹配列表。已有自定义值
仍然可以编辑。

主要关联：

- `Players.Team`、`Staff.Team`、阵容战队 → `Teams.Nick`。
- 青训战队 → 战队表。
- 首发 IGL、阵容选手 → 选手表。
- 锦标赛国家 → 该国家对应的城市。

未选择国家时，锦标赛地区保持禁用。更改国家会清除不匹配的地区；输入不匹配的
地区并离开字段时也会自动清除，同时显示校验提示。

### 中英文切换

点击顶部的 `EN` 或“中文”按钮切换语言。数据表名称、按钮、字段标签、校验信息、
工作流说明、结构分析和图片提示都会切换；数据库中的实际字段值不会被翻译或改写。

### 网络图片预览

当 `PhotoUrl` 等图片字段包含 HTTP(S) 地址，或 URL 以常见图片扩展名结尾时，编辑器
会自动请求网络图片并显示缩略图。图片使用懒加载，不会写入导出的 ZIP。

隐私说明：加载网络图片会向该图片地址发出普通浏览器请求，远程服务器可能看到
用户 IP 等常规请求信息；数据库 ZIP 本身仍然不会上传。防盗链、地址过期、服务器
离线或证书错误可能导致预览失败，但不会阻止字段编辑和 ZIP 导出。

### 游戏自定义图片

编辑器会自动生成 PNG 名称，并显示以下目录：

```text
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Players
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Teams
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Staffs
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Sponsors
%USERPROFILE%\AppData\LocalLow\NeuronaGames\EsportsManager\CustomAssets\Tournaments
```

选手和员工使用 `Internal ID`；战队和锦标赛使用全名；赞助商使用赞助商编号。

### 开发与测试

进入 `web-editor/` 后运行：

```powershell
npm run dev
npm run build
npm test
```

测试覆盖生产构建、页面外壳、国家/城市目录、可搜索输入、中英文界面、网络图片预览、
嵌套 ZIP 识别和无关文件保留。

### 常见问题

#### 找不到游戏元数据

确认 Steam 和游戏已安装，或在命令行使用 `--game-dir`、`--metadata` 手动指定。

#### 找不到正确密钥

数据库可能来自旧游戏版本。请使用对应版本的 `global-metadata.dat`，或用 `--key`
提供已保存的密钥。

#### 游戏拒绝加密后的数据库

- 检查 CSV 文件名、表头、分号分隔符、编码、ID 和必需列。
- 确认使用当前游戏版本的元数据加密。
- 修正游戏要求的战队、选手和国家/地区关联校验。
- 保留原始数据库备份。

#### 编辑器无法解析 ZIP

确认上传的是解密后的 `.zip`，不是仍然加密的 `.emdb`，并检查六个必需文件。

#### 网络缩略图无法加载

在普通浏览器标签中检查该 URL。远程服务器可能禁止第三方图片请求或要求登录；
这不会影响编辑和导出。

### 隐私、安全与限制

- EMDB 加密、解密和 ZIP 编辑均在本地完成。
- Tool 不会发起网络请求。
- Editer 只会为缩略图预览请求图片字段中已有的网络地址。
- 不读取 Steam 密码、浏览器会话或登录令牌。
- 不启动、注入或修改正在运行的游戏进程。
- Tool 在解压前检查 ZIP 路径，防止目录穿越。
- 导出创建新文件，不覆盖源数据库。
- 校验可以发现已知结构与关联问题，但不能保证兼容所有未来游戏版本。
- 游戏更新可能改变容器、密钥表示、字段、有效值或图片目录。
