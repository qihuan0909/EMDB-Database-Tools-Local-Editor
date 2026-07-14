#!/usr/bin/env python3
"""Encrypt and decrypt Esports Manager 2026 EMDB databases.

The current key is recovered from the installed game's IL2CPP
global-metadata.dat. Decryption identifies the key through a CRC-validated ZIP;
encryption packages a CSV directory or ZIP and writes a fully authenticated
EMDB. No game process needs to be started.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import os
from pathlib import Path
import re
import secrets
import struct
import sys
import zipfile

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ModuleNotFoundError:  # pragma: no cover - depends on the user's Python
    Cipher = algorithms = modes = AESGCM = None


APP_ID = "2749950"
GAME_NAME = "Esports Manager 2026"
METADATA_RELATIVE_PATH = Path(
    "EsportsManager_Data/il2cpp_data/Metadata/global-metadata.dat"
)
HEX_KEY_RE = re.compile(rb"[0-9A-Fa-f]{32,64}")


class EmdbError(RuntimeError):
    """Raised when an EMDB file or its matching key cannot be processed."""


def require_cryptography() -> None:
    """Report the optional source dependency only when crypto is requested."""
    if AESGCM is None:
        raise EmdbError(
            "Missing dependency 'cryptography'. Install it with: "
            f"{sys.executable} -m pip install -r requirements.txt"
        )


def validate_emdb(raw: bytes) -> None:
    if len(raw) < 34:
        raise EmdbError("EMDB file is too small")
    if raw[:4] != b"EMDB":
        raise EmdbError("invalid EMDB magic")


def increment_counter(counter: bytearray) -> None:
    """Increment the low 32 bits using the game's big-endian counter rule."""
    value = (int.from_bytes(counter[-4:], "big") + 1) & 0xFFFFFFFF
    counter[-4:] = value.to_bytes(4, "big")


def aes_ctr_decrypt(ciphertext: bytes, nonce: bytes, key: bytes) -> bytes:
    """Apply the CTR portion of the game's custom AesGcmManaged implementation."""
    require_cryptography()
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    counter = bytearray(nonce + b"\x00\x00\x00\x01")
    plaintext = bytearray()

    for offset in range(0, len(ciphertext), 16):
        increment_counter(counter)
        key_stream = encryptor.update(bytes(counter))
        block = ciphertext[offset : offset + 16]
        plaintext.extend(a ^ b for a, b in zip(block, key_stream))

    encryptor.finalize()
    return bytes(plaintext)


def decrypt_emdb_with_key(raw: bytes, key: bytes) -> bytes:
    validate_emdb(raw)
    # Layout confirmed from EmdbExtractor.DecryptAesGcm:
    # EMDB(4) | version(1) | nonce(12) | ciphertext | custom GCM tag(16)
    return aes_ctr_decrypt(raw[17:-16], raw[5:17], key)


def encrypt_zip_to_emdb(zip_bytes: bytes, key: bytes, version: int = 3) -> bytes:
    """Encrypt a ZIP using the exact EMDB layout accepted by the game."""
    require_cryptography()
    if not 0 <= version <= 255:
        raise EmdbError("EMDB version must fit in one byte")
    inspect_zip(zip_bytes, check_crc=True)
    nonce = secrets.token_bytes(12)
    # AESGCM.encrypt returns ciphertext followed by its 16-byte authentication tag.
    ciphertext_and_tag = AESGCM(key).encrypt(nonce, zip_bytes, None)
    result = b"EMDB" + bytes([version]) + nonce + ciphertext_and_tag

    # Verify both the GCM tag and the game's existing decryption path before writing.
    verified = AESGCM(key).decrypt(nonce, ciphertext_and_tag, None)
    if verified != zip_bytes or decrypt_emdb_with_key(result, key) != zip_bytes:
        raise EmdbError("internal EMDB encryption verification failed")
    return result


def decrypts_to_zip_prefix(raw: bytes, key: bytes) -> bool:
    """Cheaply reject wrong keys after decrypting only the first block."""
    if len(key) not in (16, 24, 32):
        return False
    first_block = aes_ctr_decrypt(raw[17:33], raw[5:17], key)
    return first_block.startswith(b"PK\x03\x04")


def inspect_zip(zip_bytes: bytes, check_crc: bool = True) -> list[str]:
    """Return archive members after structural and optional full CRC validation."""
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            names = archive.namelist()
            if not names or not any(name.lower().endswith(".csv") for name in names):
                raise EmdbError("decrypted ZIP does not contain CSV files")
            if check_crc:
                bad_file = archive.testzip()
                if bad_file is not None:
                    raise EmdbError(f"ZIP CRC validation failed for {bad_file!r}")
            return names
    except (OSError, zipfile.BadZipFile, zipfile.LargeZipFile) as exc:
        raise EmdbError(f"decrypted payload is not a valid ZIP: {exc}") from exc


def build_zip_from_source(source: Path) -> tuple[bytes, list[str]]:
    """Read a valid ZIP or build one from CSV files in a directory."""
    source = source.resolve()
    if source.is_file():
        if source.suffix.casefold() != ".zip":
            raise EmdbError("encryption input must be a CSV directory or a .zip file")
        zip_bytes = source.read_bytes()
        return zip_bytes, inspect_zip(zip_bytes, check_crc=True)

    if not source.is_dir():
        raise EmdbError(f"encryption input does not exist: {source}")

    members = sorted(
        (
            path
            for path in source.rglob("*")
            if path.is_file()
            and (path.suffix.casefold() == ".csv" or path.name.casefold() == "roster_order.json")
        ),
        key=lambda path: path.relative_to(source).as_posix().casefold(),
    )
    if not any(path.suffix.casefold() == ".csv" for path in members):
        raise EmdbError(f"no CSV files were found under {source}")

    output = io.BytesIO()
    with zipfile.ZipFile(
        output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for path in members:
            archive.write(path, path.relative_to(source).as_posix())
    zip_bytes = output.getvalue()
    return zip_bytes, inspect_zip(zip_bytes, check_crc=True)


def il2cpp_string_literals(metadata: bytes) -> list[bytes]:
    """Parse string literals from classic and Unity metadata-v39 layouts."""
    if len(metadata) < 32:
        return []
    sanity, version = struct.unpack_from("<II", metadata)
    if sanity != 0xFAB11BAF:
        return []

    values = struct.unpack_from("<7I", metadata)

    # Unity metadata v39 stores a uint32 offset for each literal, followed by
    # one contiguous literal-data blob.  The extra count field makes the
    # layout self-validating and avoids guessing literal boundaries.
    table_offset, table_size = values[2], values[3]
    literal_count, data_offset, data_size = values[4], values[5], values[6]
    if (
        version >= 39
        and table_size == literal_count * 4
        and table_offset + table_size <= len(metadata)
        and data_offset + data_size <= len(metadata)
    ):
        offsets = struct.unpack_from(f"<{literal_count}I", metadata, table_offset)
        literals = []
        for index, start in enumerate(offsets):
            end = offsets[index + 1] if index + 1 < literal_count else data_size
            if start <= end <= data_size:
                literals.append(metadata[data_offset + start : data_offset + end])
        return literals

    # Older IL2CPP metadata uses Il2CppStringLiteral records containing
    # (length, dataIndex), followed by the literal-data blob.
    data_offset, data_size = values[4], values[5]
    if (
        table_size % 8 == 0
        and table_offset + table_size <= len(metadata)
        and data_offset + data_size <= len(metadata)
    ):
        literals = []
        for record_offset in range(table_offset, table_offset + table_size, 8):
            length, data_index = struct.unpack_from("<II", metadata, record_offset)
            if data_index + length <= data_size:
                literals.append(metadata[data_offset + data_index : data_offset + data_index + length])
        return literals
    return []


def key_candidates(metadata: bytes) -> list[bytes]:
    """Extract unique AES-128/192/256 hexadecimal string literals."""
    candidates: list[bytes] = []
    seen: set[bytes] = set()

    literals = il2cpp_string_literals(metadata)
    sources = literals if literals else (match.group() for match in HEX_KEY_RE.finditer(metadata))
    for source in sources:
        if len(source) not in (32, 48, 64) or re.fullmatch(rb"[0-9A-Fa-f]+", source) is None:
            continue
        candidate = bytes.fromhex(source.decode("ascii"))
        if candidate not in seen:
            seen.add(candidate)
            candidates.append(candidate)
    return candidates


def recover_key(raw: bytes, metadata_paths: list[Path]) -> tuple[bytes, bytes, Path]:
    """Try metadata key literals and return the uniquely CRC-validated result."""
    tried: set[bytes] = set()
    matches: list[tuple[bytes, bytes, Path]] = []

    for metadata_path in metadata_paths:
        candidates = key_candidates(metadata_path.read_bytes())
        print(f"Scanning {metadata_path} ({len(candidates)} AES candidates)...")
        for key in candidates:
            if key in tried:
                continue
            tried.add(key)
            if not decrypts_to_zip_prefix(raw, key):
                continue
            plaintext = decrypt_emdb_with_key(raw, key)
            try:
                inspect_zip(plaintext, check_crc=True)
            except EmdbError:
                continue
            matches.append((key, plaintext, metadata_path))

    if not matches:
        raise EmdbError(
            "no matching key was found. The database may belong to an older game "
            "build, or the EMDB format/key representation may have changed. Use "
            "--metadata with that build's global-metadata.dat or --key with a saved key."
        )
    if len(matches) > 1:
        keys = ", ".join(key.hex().upper() for key, _, _ in matches)
        raise EmdbError(f"multiple CRC-valid keys were found unexpectedly: {keys}")
    return matches[0]


def recover_encryption_key(
    metadata_paths: list[Path], reference_emdb: Path | None = None
) -> tuple[bytes, Path]:
    """Recover the current key for encryption, optionally using a reference DB."""
    if reference_emdb is not None:
        reference_raw = reference_emdb.resolve().read_bytes()
        key, _, metadata_path = recover_key(reference_raw, metadata_paths)
        return key, metadata_path

    found: dict[bytes, Path] = {}
    for metadata_path in metadata_paths:
        candidates = key_candidates(metadata_path.read_bytes())
        print(f"Scanning {metadata_path} ({len(candidates)} AES candidates)...")
        for key in candidates:
            found.setdefault(key, metadata_path)

    if not found:
        raise EmdbError("no AES key literals were found in the selected metadata")
    if len(found) > 1:
        raise EmdbError(
            "multiple AES candidates were found. Supply --reference-emdb so they can "
            "be tested, or provide the desired key with --key."
        )
    key, metadata_path = next(iter(found.items()))
    return key, metadata_path


def parse_vdf_paths(vdf_path: Path) -> list[Path]:
    """Read Steam library paths without requiring a third-party VDF parser."""
    if not vdf_path.is_file():
        return []
    text = vdf_path.read_text(encoding="utf-8", errors="replace")
    paths = []
    for value in re.findall(r'"path"\s+"([^"]+)"', text, flags=re.IGNORECASE):
        paths.append(Path(value.replace("\\\\", "\\")))
    return paths


def steam_roots() -> list[Path]:
    """Discover likely Steam installation roots on Windows."""
    roots: list[Path] = []

    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
                roots.append(Path(winreg.QueryValueEx(key, "SteamPath")[0]))
        except (FileNotFoundError, OSError):
            pass

        for variable in ("ProgramFiles(x86)", "ProgramFiles"):
            if os.environ.get(variable):
                roots.append(Path(os.environ[variable]) / "Steam")
        for drive in "CDEFGHIJKLMNOPQRSTUVWXYZ":
            roots.append(Path(f"{drive}:\\SteamLibrary"))

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        marker = str(root).casefold()
        if marker not in seen and root.is_dir():
            seen.add(marker)
            unique.append(root)
    return unique


def metadata_from_library(library: Path) -> list[Path]:
    steamapps = library / "steamapps"
    manifest = steamapps / f"appmanifest_{APP_ID}.acf"
    install_dirs: list[str] = []

    if manifest.is_file():
        text = manifest.read_text(encoding="utf-8", errors="replace")
        match = re.search(r'"installdir"\s+"([^"]+)"', text, flags=re.IGNORECASE)
        if match:
            install_dirs.append(match.group(1).replace("\\\\", "\\"))
    install_dirs.append(GAME_NAME)

    results = []
    for install_dir in dict.fromkeys(install_dirs):
        candidate = steamapps / "common" / install_dir / METADATA_RELATIVE_PATH
        if candidate.is_file():
            results.append(candidate.resolve())
    return results


def discover_metadata(game_dir: Path | None = None) -> list[Path]:
    """Locate current metadata using an explicit game directory or Steam libraries."""
    if game_dir is not None:
        game_dir = game_dir.resolve()
        direct = game_dir / METADATA_RELATIVE_PATH
        if direct.is_file():
            return [direct]
        matches = list(game_dir.rglob("global-metadata.dat"))
        if matches:
            return sorted((path.resolve() for path in matches), key=lambda p: p.stat().st_mtime, reverse=True)
        raise EmdbError(f"global-metadata.dat was not found under {game_dir}")

    libraries: list[Path] = []
    for root in steam_roots():
        libraries.append(root)
        libraries.extend(parse_vdf_paths(root / "steamapps" / "libraryfolders.vdf"))

    results: list[Path] = []
    seen: set[str] = set()
    for library in libraries:
        for path in metadata_from_library(library):
            marker = str(path).casefold()
            if marker not in seen:
                seen.add(marker)
                results.append(path)
    return sorted(results, key=lambda p: p.stat().st_mtime, reverse=True)


def validate_and_extract(zip_bytes: bytes, output_dir: Path) -> list[str]:
    """CRC-check and safely extract a decrypted ZIP."""
    names = inspect_zip(zip_bytes, check_crc=True)
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        for member in archive.infolist():
            target = (output_dir / member.filename).resolve()
            if output_dir != target and output_dir not in target.parents:
                raise EmdbError(f"unsafe ZIP path: {member.filename!r}")
        archive.extractall(output_dir)
    return names


def parse_key(value: str) -> bytes:
    try:
        key = bytes.fromhex(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("key must be hexadecimal") from exc
    if len(key) not in (16, 24, 32):
        raise argparse.ArgumentTypeError("key must contain 32, 48, or 64 hex characters")
    return key


def add_key_source_arguments(
    parser: argparse.ArgumentParser, *, include_reference: bool = False
) -> None:
    parser.add_argument("--metadata", type=Path, help="explicit global-metadata.dat path")
    parser.add_argument("--game-dir", type=Path, help="explicit Esports Manager 2026 directory")
    parser.add_argument("--key", type=parse_key, help="known AES key; skips automatic recovery")
    if include_reference:
        parser.add_argument(
            "--reference-emdb",
            type=Path,
            help="known-good EMDB used to identify the key when metadata has multiple candidates",
        )


def add_decrypt_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("input", type=Path, help="input .emdb file")
    add_key_source_arguments(parser)
    parser.add_argument("--out-dir", type=Path, help="CSV output directory")
    parser.add_argument("--zip-output", type=Path, help="decrypted ZIP output path")


def add_encrypt_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("source", type=Path, help="CSV directory or decrypted .zip file")
    add_key_source_arguments(parser, include_reference=True)
    parser.add_argument("--output", type=Path, help="output .emdb path")
    parser.add_argument("--version", type=int, default=3, help="EMDB version byte (default: 3)")
    parser.add_argument("--force", action="store_true", help="overwrite an existing output file")


def build_root_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    decrypt_parser = commands.add_parser("decrypt", help="decrypt an EMDB database")
    add_decrypt_arguments(decrypt_parser)
    encrypt_parser = commands.add_parser("encrypt", help="encrypt a CSV directory or ZIP")
    add_encrypt_arguments(encrypt_parser)
    return parser


def build_legacy_decrypt_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Decrypt an EMDB database (legacy command-line form)."
    )
    add_decrypt_arguments(parser)
    return parser


def metadata_paths_from_args(args: argparse.Namespace) -> list[Path]:
    if args.metadata is not None:
        metadata_path = args.metadata.resolve()
        if not metadata_path.is_file():
            raise EmdbError(f"metadata file does not exist: {metadata_path}")
        return [metadata_path]
    metadata_paths = discover_metadata(args.game_dir)
    if not metadata_paths:
        raise EmdbError(
            "could not locate global-metadata.dat automatically; pass --game-dir or --metadata"
        )
    return metadata_paths


def run_decrypt(args: argparse.Namespace) -> None:
    source = args.input.resolve()
    raw = source.read_bytes()
    validate_emdb(raw)

    if args.key is not None:
        key = args.key
        zip_bytes = decrypt_emdb_with_key(raw, key)
        inspect_zip(zip_bytes, check_crc=True)
        metadata_used = None
    else:
        metadata_paths = metadata_paths_from_args(args)
        key, zip_bytes, metadata_used = recover_key(raw, metadata_paths)

    output_dir = (args.out_dir or source.with_name(source.stem + "_csv")).resolve()
    zip_output = (args.zip_output or source.with_name(source.stem + "_decrypted.zip")).resolve()
    names = validate_and_extract(zip_bytes, output_dir)
    zip_output.write_bytes(zip_bytes)

    print(f"EMDB version: {raw[4]}")
    print(f"Recovered AES key: {key.hex().upper()}")
    if metadata_used is not None:
        print(f"Metadata source: {metadata_used}")
    print(f"Decrypted ZIP: {zip_output}")
    print(f"Extracted directory: {output_dir}")
    print("Files:")
    for name in names:
        print(f"  {name}")


def default_emdb_output(source: Path) -> Path:
    source = source.resolve()
    if source.is_file():
        return source.with_suffix(".emdb")
    return source.with_name(source.name + ".emdb")


def run_encrypt(args: argparse.Namespace) -> None:
    source = args.source.resolve()
    zip_bytes, source_names = build_zip_from_source(source)

    if args.key is not None:
        key = args.key
        metadata_used = None
    else:
        metadata_paths = metadata_paths_from_args(args)
        reference = args.reference_emdb.resolve() if args.reference_emdb else None
        key, metadata_used = recover_encryption_key(metadata_paths, reference)

    output = (args.output or default_emdb_output(source)).resolve()
    if output.exists() and not args.force:
        raise EmdbError(f"output already exists: {output}; use --force to overwrite it")

    emdb_bytes = encrypt_zip_to_emdb(zip_bytes, key, args.version)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(emdb_bytes)

    # Final read-back validation includes the generated GCM tag and ZIP CRCs.
    encrypted = output.read_bytes()
    verified_zip = AESGCM(key).decrypt(encrypted[5:17], encrypted[17:], None)
    verified_names = inspect_zip(verified_zip, check_crc=True)
    if verified_names != source_names:
        raise EmdbError("encrypted EMDB read-back validation changed the archive members")

    print(f"EMDB version: {args.version}")
    print(f"AES key: {key.hex().upper()}")
    if metadata_used is not None:
        print(f"Metadata source: {metadata_used}")
    print(f"Encrypted EMDB: {output}")
    print("Files:")
    for name in verified_names:
        print(f"  {name}")


def clean_input_path(value: str) -> Path:
    return Path(value.strip().strip('"').strip("'"))


def gui_main_legacy() -> int:
    """Launch the Windows GUI used by the packaged executable."""
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.title("Esports Manager 2026 EMDB 工具")
    root.geometry("560x330")
    root.resizable(False, False)

    style = ttk.Style(root)
    if "vista" in style.theme_names():
        style.theme_use("vista")
    style.configure("Title.TLabel", font=("Microsoft YaHei UI", 18, "bold"))
    style.configure("Info.TLabel", font=("Microsoft YaHei UI", 10))
    style.configure("Action.TButton", font=("Microsoft YaHei UI", 12), padding=(18, 14))

    outer = ttk.Frame(root, padding=28)
    outer.pack(fill="both", expand=True)
    ttk.Label(outer, text="EMDB 数据库工具", style="Title.TLabel").pack(pady=(4, 10))
    ttk.Label(
        outer,
        text="自动从当前游戏提取密钥；通过文件资源管理器选择输入和输出。",
        style="Info.TLabel",
    ).pack(pady=(0, 24))

    button_row = ttk.Frame(outer)
    button_row.pack(fill="x", pady=4)
    button_row.columnconfigure((0, 1), weight=1)

    status = tk.StringVar(value="请选择要执行的操作")

    def execute_with_capture(operation, args) -> str:
        log = io.StringIO()
        root.configure(cursor="wait")
        status.set("正在处理，请稍候……")
        root.update_idletasks()
        try:
            with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                operation(args)
            return log.getvalue()
        finally:
            root.configure(cursor="")
            status.set("处理完成" if log.getvalue() else "请选择要执行的操作")

    def decrypt_action() -> None:
        selected = filedialog.askopenfilename(
            parent=root,
            title="选择要解密的 EMDB 文件",
            filetypes=(("EMDB 数据库", "*.emdb"), ("所有文件", "*.*")),
        )
        if not selected:
            return
        source = Path(selected).resolve()
        destination = filedialog.askdirectory(
            parent=root,
            title="选择解密结果保存目录",
            initialdir=str(source.parent),
            mustexist=True,
        )
        if not destination:
            return
        destination_path = Path(destination).resolve()
        out_dir = destination_path / (source.stem + "_csv")
        zip_output = destination_path / (source.stem + "_decrypted.zip")
        if (out_dir.exists() or zip_output.exists()) and not messagebox.askyesno(
            "确认覆盖",
            "目标位置已存在同名解密结果，是否覆盖？",
            parent=root,
        ):
            return

        args = argparse.Namespace(
            input=source,
            metadata=None,
            game_dir=None,
            key=None,
            out_dir=out_dir,
            zip_output=zip_output,
        )
        try:
            execute_with_capture(run_decrypt, args)
            messagebox.showinfo(
                "解密成功",
                f"CSV 目录：\n{out_dir}\n\n解密 ZIP：\n{zip_output}",
                parent=root,
            )
        except (EmdbError, OSError, ValueError) as exc:
            status.set("解密失败")
            messagebox.showerror("解密失败", str(exc), parent=root)

    def choose_encrypt_source() -> Path | None:
        choice = messagebox.askyesnocancel(
            "选择加密输入",
            "选择输入类型：\n\n“是”——选择已经打包好的 ZIP\n“否”——选择包含 CSV 的目录",
            parent=root,
        )
        if choice is None:
            return None
        if choice:
            selected = filedialog.askopenfilename(
                parent=root,
                title="选择要加密的 ZIP",
                filetypes=(("ZIP 压缩包", "*.zip"), ("所有文件", "*.*")),
            )
        else:
            selected = filedialog.askdirectory(
                parent=root,
                title="选择包含 CSV 的目录",
                mustexist=True,
            )
        return Path(selected).resolve() if selected else None

    def encrypt_action() -> None:
        source = choose_encrypt_source()
        if source is None:
            return
        default_output = default_emdb_output(source)
        selected_output = filedialog.asksaveasfilename(
            parent=root,
            title="保存加密后的 EMDB",
            initialdir=str(default_output.parent),
            initialfile=default_output.name,
            defaultextension=".emdb",
            filetypes=(("EMDB 数据库", "*.emdb"), ("所有文件", "*.*")),
            confirmoverwrite=True,
        )
        if not selected_output:
            return
        output = Path(selected_output).resolve()

        args = argparse.Namespace(
            source=source,
            metadata=None,
            game_dir=None,
            key=None,
            reference_emdb=None,
            output=output,
            version=3,
            force=True,
        )
        try:
            execute_with_capture(run_encrypt, args)
        except EmdbError as exc:
            if "multiple AES candidates" not in str(exc):
                status.set("加密失败")
                messagebox.showerror("加密失败", str(exc), parent=root)
                return
            reference = filedialog.askopenfilename(
                parent=root,
                title="候选密钥不唯一，请选择一个当前版本可用的 EMDB",
                filetypes=(("EMDB 数据库", "*.emdb"), ("所有文件", "*.*")),
            )
            if not reference:
                status.set("已取消")
                return
            args.reference_emdb = Path(reference).resolve()
            try:
                execute_with_capture(run_encrypt, args)
            except (EmdbError, OSError, ValueError) as retry_exc:
                status.set("加密失败")
                messagebox.showerror("加密失败", str(retry_exc), parent=root)
                return
        except (OSError, ValueError) as exc:
            status.set("加密失败")
            messagebox.showerror("加密失败", str(exc), parent=root)
            return

        messagebox.showinfo("加密成功", f"EMDB 已保存至：\n{output}", parent=root)

    ttk.Button(
        button_row, text="解密 EMDB", style="Action.TButton", command=decrypt_action
    ).grid(row=0, column=0, sticky="ew", padx=(0, 9))
    ttk.Button(
        button_row, text="加密 CSV / ZIP", style="Action.TButton", command=encrypt_action
    ).grid(row=0, column=1, sticky="ew", padx=(9, 0))
    ttk.Separator(outer).pack(fill="x", pady=(30, 14))
    ttk.Label(outer, textvariable=status, anchor="center", style="Info.TLabel").pack(fill="x")

    root.mainloop()
    return 0


GUI_TEXT = {
    "zh": {
        "app_title": "Esports Manager 2026 EMDB 工具",
        "heading": "EMDB 数据库工具",
        "info": "自动从当前游戏提取密钥；通过文件资源管理器选择输入和输出。",
        "language": "语言",
        "decrypt": "解密 EMDB",
        "encrypt": "加密 CSV / ZIP",
        "ready": "请选择要执行的操作",
        "working": "正在处理，请稍候……",
        "done": "处理完成",
        "decrypt_pick": "选择要解密的 EMDB 文件",
        "decrypt_out": "选择解密结果保存目录",
        "emdb_type": "EMDB 数据库",
        "all_type": "所有文件",
        "overwrite_title": "确认覆盖",
        "overwrite_msg": "目标位置已存在同名解密结果，是否覆盖？",
        "decrypt_ok_title": "解密成功",
        "decrypt_ok_msg": "CSV 目录：\n{csv}\n\n解密 ZIP：\n{zip}",
        "decrypt_fail": "解密失败",
        "source_title": "选择加密输入",
        "source_msg": "选择输入类型：\n\n“是”——选择已经打包好的 ZIP\n“否”——选择包含 CSV 的目录",
        "zip_pick": "选择要加密的 ZIP",
        "zip_type": "ZIP 压缩包",
        "folder_pick": "选择包含 CSV 的目录",
        "save_emdb": "保存加密后的 EMDB",
        "reference_pick": "候选密钥不唯一，请选择一个当前版本可用的 EMDB",
        "cancelled": "已取消",
        "encrypt_fail": "加密失败",
        "encrypt_ok_title": "加密成功",
        "encrypt_ok_msg": "EMDB 已保存至：\n{output}",
    },
    "en": {
        "app_title": "Esports Manager 2026 EMDB Tool",
        "heading": "EMDB Database Tool",
        "info": "Automatically recover the current key and choose input/output in File Explorer.",
        "language": "Language",
        "decrypt": "Decrypt EMDB",
        "encrypt": "Encrypt CSV / ZIP",
        "ready": "Choose an operation",
        "working": "Processing, please wait...",
        "done": "Completed",
        "decrypt_pick": "Select the EMDB file to decrypt",
        "decrypt_out": "Select a folder for decrypted output",
        "emdb_type": "EMDB database",
        "all_type": "All files",
        "overwrite_title": "Confirm overwrite",
        "overwrite_msg": "Matching decrypted output already exists. Overwrite it?",
        "decrypt_ok_title": "Decryption complete",
        "decrypt_ok_msg": "CSV directory:\n{csv}\n\nDecrypted ZIP:\n{zip}",
        "decrypt_fail": "Decryption failed",
        "source_title": "Choose encryption input",
        "source_msg": "Choose the input type:\n\nYes — select an existing ZIP\nNo — select a directory containing CSV files",
        "zip_pick": "Select the ZIP to encrypt",
        "zip_type": "ZIP archive",
        "folder_pick": "Select the directory containing CSV files",
        "save_emdb": "Save the encrypted EMDB",
        "reference_pick": "Multiple keys were found; select a working EMDB from the current build",
        "cancelled": "Cancelled",
        "encrypt_fail": "Encryption failed",
        "encrypt_ok_title": "Encryption complete",
        "encrypt_ok_msg": "EMDB saved to:\n{output}",
    },
}


def gui_main() -> int:
    """Launch the bilingual Windows GUI used by the packaged executable."""
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root = tk.Tk()
    root.geometry("600x370")
    root.resizable(False, False)

    style = ttk.Style(root)
    if "vista" in style.theme_names():
        style.theme_use("vista")
    style.configure("Title.TLabel", font=("Microsoft YaHei UI", 18, "bold"))
    style.configure("Info.TLabel", font=("Microsoft YaHei UI", 10))
    style.configure("Action.TButton", font=("Microsoft YaHei UI", 12), padding=(18, 14))

    language_choice = tk.StringVar(value="简体中文")
    title_text = tk.StringVar()
    info_text = tk.StringVar()
    language_text = tk.StringVar()
    decrypt_text = tk.StringVar()
    encrypt_text = tk.StringVar()
    status = tk.StringVar()

    def language_code() -> str:
        return "en" if language_choice.get() == "English" else "zh"

    def tr(key: str) -> str:
        return GUI_TEXT[language_code()][key]

    def update_language(*_args) -> None:
        root.title(tr("app_title"))
        title_text.set(tr("heading"))
        info_text.set(tr("info"))
        language_text.set(tr("language"))
        decrypt_text.set(tr("decrypt"))
        encrypt_text.set(tr("encrypt"))
        status.set(tr("ready"))

    outer = ttk.Frame(root, padding=28)
    outer.pack(fill="both", expand=True)
    language_row = ttk.Frame(outer)
    language_row.pack(fill="x")
    language_box = ttk.Combobox(
        language_row,
        textvariable=language_choice,
        values=("简体中文", "English"),
        state="readonly",
        width=14,
    )
    language_box.pack(side="right")
    ttk.Label(language_row, textvariable=language_text).pack(side="right", padx=(0, 8))
    language_box.bind("<<ComboboxSelected>>", update_language)

    ttk.Label(outer, textvariable=title_text, style="Title.TLabel").pack(pady=(10, 10))
    ttk.Label(outer, textvariable=info_text, style="Info.TLabel").pack(pady=(0, 26))

    button_row = ttk.Frame(outer)
    button_row.pack(fill="x", pady=4)
    button_row.columnconfigure(0, weight=1)
    button_row.columnconfigure(1, weight=1)

    def execute_with_capture(operation, args) -> str:
        log = io.StringIO()
        root.configure(cursor="wait")
        status.set(tr("working"))
        root.update_idletasks()
        try:
            with contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
                operation(args)
            status.set(tr("done"))
            return log.getvalue()
        finally:
            root.configure(cursor="")

    def decrypt_action() -> None:
        selected = filedialog.askopenfilename(
            parent=root,
            title=tr("decrypt_pick"),
            filetypes=((tr("emdb_type"), "*.emdb"), (tr("all_type"), "*.*")),
        )
        if not selected:
            return
        source = Path(selected).resolve()
        destination = filedialog.askdirectory(
            parent=root,
            title=tr("decrypt_out"),
            initialdir=str(source.parent),
            mustexist=True,
        )
        if not destination:
            return
        destination_path = Path(destination).resolve()
        out_dir = destination_path / (source.stem + "_csv")
        zip_output = destination_path / (source.stem + "_decrypted.zip")
        if (out_dir.exists() or zip_output.exists()) and not messagebox.askyesno(
            tr("overwrite_title"), tr("overwrite_msg"), parent=root
        ):
            return

        args = argparse.Namespace(
            input=source,
            metadata=None,
            game_dir=None,
            key=None,
            out_dir=out_dir,
            zip_output=zip_output,
        )
        try:
            execute_with_capture(run_decrypt, args)
            messagebox.showinfo(
                tr("decrypt_ok_title"),
                tr("decrypt_ok_msg").format(csv=out_dir, zip=zip_output),
                parent=root,
            )
        except (EmdbError, OSError, ValueError) as exc:
            status.set(tr("decrypt_fail"))
            messagebox.showerror(tr("decrypt_fail"), str(exc), parent=root)

    def choose_encrypt_source() -> Path | None:
        choice = messagebox.askyesnocancel(
            tr("source_title"), tr("source_msg"), parent=root
        )
        if choice is None:
            return None
        if choice:
            selected = filedialog.askopenfilename(
                parent=root,
                title=tr("zip_pick"),
                filetypes=((tr("zip_type"), "*.zip"), (tr("all_type"), "*.*")),
            )
        else:
            selected = filedialog.askdirectory(
                parent=root, title=tr("folder_pick"), mustexist=True
            )
        return Path(selected).resolve() if selected else None

    def encrypt_action() -> None:
        source = choose_encrypt_source()
        if source is None:
            return
        default_output = default_emdb_output(source)
        selected_output = filedialog.asksaveasfilename(
            parent=root,
            title=tr("save_emdb"),
            initialdir=str(default_output.parent),
            initialfile=default_output.name,
            defaultextension=".emdb",
            filetypes=((tr("emdb_type"), "*.emdb"), (tr("all_type"), "*.*")),
            confirmoverwrite=True,
        )
        if not selected_output:
            return
        output = Path(selected_output).resolve()
        args = argparse.Namespace(
            source=source,
            metadata=None,
            game_dir=None,
            key=None,
            reference_emdb=None,
            output=output,
            version=3,
            force=True,
        )
        try:
            execute_with_capture(run_encrypt, args)
        except EmdbError as exc:
            if "multiple AES candidates" not in str(exc):
                status.set(tr("encrypt_fail"))
                messagebox.showerror(tr("encrypt_fail"), str(exc), parent=root)
                return
            reference = filedialog.askopenfilename(
                parent=root,
                title=tr("reference_pick"),
                filetypes=((tr("emdb_type"), "*.emdb"), (tr("all_type"), "*.*")),
            )
            if not reference:
                status.set(tr("cancelled"))
                return
            args.reference_emdb = Path(reference).resolve()
            try:
                execute_with_capture(run_encrypt, args)
            except (EmdbError, OSError, ValueError) as retry_exc:
                status.set(tr("encrypt_fail"))
                messagebox.showerror(tr("encrypt_fail"), str(retry_exc), parent=root)
                return
        except (OSError, ValueError) as exc:
            status.set(tr("encrypt_fail"))
            messagebox.showerror(tr("encrypt_fail"), str(exc), parent=root)
            return

        messagebox.showinfo(
            tr("encrypt_ok_title"),
            tr("encrypt_ok_msg").format(output=output),
            parent=root,
        )

    ttk.Button(
        button_row, textvariable=decrypt_text, style="Action.TButton", command=decrypt_action
    ).grid(row=0, column=0, sticky="ew", padx=(0, 9))
    ttk.Button(
        button_row, textvariable=encrypt_text, style="Action.TButton", command=encrypt_action
    ).grid(row=0, column=1, sticky="ew", padx=(9, 0))
    ttk.Separator(outer).pack(fill="x", pady=(30, 14))
    ttk.Label(outer, textvariable=status, anchor="center", style="Info.TLabel").pack(fill="x")

    update_language()
    root.mainloop()
    return 0


def interactive_menu() -> int:
    """Console menu shown when the script is opened without arguments."""
    while True:
        print("\n" + "=" * 52)
        print("        Esports Manager 2026 EMDB 工具")
        print("=" * 52)
        print("  1. 解密 EMDB")
        print("  2. 加密 CSV 目录或 ZIP")
        print("  0. 退出")
        choice = input("\n请选择 [0/1/2]: ").strip()

        try:
            if choice == "0":
                return 0
            if choice == "1":
                source = clean_input_path(input("请输入 .emdb 文件路径: "))
                args = argparse.Namespace(
                    input=source,
                    metadata=None,
                    game_dir=None,
                    key=None,
                    out_dir=None,
                    zip_output=None,
                )
                run_decrypt(args)
            elif choice == "2":
                source = clean_input_path(input("请输入 CSV 目录或解密 ZIP 路径: "))
                default_output = default_emdb_output(source)
                output_text = input(f"输出 EMDB 路径（回车使用 {default_output}）: ").strip()
                output = clean_input_path(output_text) if output_text else default_output
                reference_text = input("参考 EMDB 路径（通常留空，候选密钥不唯一时使用）: ").strip()
                reference = clean_input_path(reference_text) if reference_text else None
                force = False
                if output.exists():
                    force = input(f"{output} 已存在，是否覆盖？[y/N]: ").strip().casefold() == "y"
                    if not force:
                        print("已取消加密。")
                        input("按回车返回主菜单...")
                        continue
                args = argparse.Namespace(
                    source=source,
                    metadata=None,
                    game_dir=None,
                    key=None,
                    reference_emdb=reference,
                    output=output,
                    version=3,
                    force=force,
                )
                run_encrypt(args)
            else:
                print("无效选项，请输入 0、1 或 2。")
                continue
        except (EmdbError, OSError, ValueError) as exc:
            print(f"\n操作失败：{exc}", file=sys.stderr)
        input("\n按回车返回主菜单...")


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        return gui_main()

    if argv[0] in {"decrypt", "encrypt"}:
        args = build_root_parser().parse_args(argv)
        if args.command == "decrypt":
            run_decrypt(args)
        else:
            run_encrypt(args)
        return 0

    # Preserve the previous command form: decrypt_emdb.py database.emdb [options]
    args = build_legacy_decrypt_parser().parse_args(argv)
    run_decrypt(args)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (EmdbError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
