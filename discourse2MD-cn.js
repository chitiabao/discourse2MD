// ==UserScript==
// @name         Discourse2MD - Export to Obsidian
// @namespace    https://discourse.org/
// @version      4.6.1
// @description  导出 Discourse 社区帖子到 Obsidian（支持 Local REST API、图片处理、Callout 格式）
// @author       ilvsx
// @license      MIT
// @match        https://*/t/*
// @match        https://*/t/topic/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
    "use strict";

    const OBS_IMG_DIR_KIND = {
        RELATIVE: "relative",
        LEGACY: "legacy",
    };

    // -----------------------
    // 存储 key
    // -----------------------
    const K = {
        EXPORT_TEMPLATE: "ld_export_template",
        // 筛选相关
        RANGE_MODE: "ld_export_range_mode",
        RANGE_START: "ld_export_range_start",
        RANGE_END: "ld_export_range_end",
        FILTER_ONLY_OP: "ld_export_filter_only_op",
        FILTER_IMG: "ld_export_filter_img",
        FILTER_USERS: "ld_export_filter_users",
        FILTER_INCLUDE: "ld_export_filter_include",
        FILTER_EXCLUDE: "ld_export_filter_exclude",
        FILTER_MINLEN: "ld_export_filter_minlen",
        AI_FILTER_ENABLED: "ld_export_ai_filter_enabled",
        AI_API_URL: "ld_export_ai_api_url",
        AI_API_KEY: "ld_export_ai_api_key",
        AI_MODEL_ID: "ld_export_ai_model_id",
        // UI 状态
        PANEL_COLLAPSED: "ld_export_panel_collapsed",
        BUBBLE_Y: "ld_export_bubble_y",
        EXPORT_STYLE_OPEN: "ld_export_style_panel_open",
        // Obsidian 配置
        OBS_DIR: "ld_export_obs_dir",
        OBS_ROOTS: "ld_export_obs_roots",
        OBS_ROOT: "ld_export_obs_root",
        OBS_CATEGORIES: "ld_export_obs_categories",
        OBS_CATEGORY: "ld_export_obs_category",
        OBS_IMG_MODE: "ld_export_obs_img_mode",
        OBS_IMG_DIR: "ld_export_obs_img_dir",
        OBS_IMG_DIR_KIND: "ld_export_obs_img_dir_kind",
        OBS_API_URL: "ld_export_obs_api_url",
        OBS_API_KEY: "ld_export_obs_api_key",
        OBS_PANEL_OPEN: "ld_export_obs_panel_open",
        OBS_CONFIG_VERSION: "ld_export_obs_config_version",
    };

    const DEFAULTS = {
        exportTemplate: "forum",
        rangeMode: "all",
        rangeStart: 1,
        rangeEnd: 999999,
        onlyOp: false,
        imgFilter: "none",
        users: "",
        include: "",
        exclude: "",
        minLen: 0,
        aiEnabled: false,
        aiApiUrl: "",
        aiApiKey: "",
        aiModelId: "",
        // Obsidian 导出相关
        obsDir: "Linux.do",
        obsRoot: "Linux.do",
        obsRoots: ["Linux.do"],
        obsCategory: "未分类",
        obsCategories: ["未分类"],
        obsImgMode: "file",
        obsImgDir: "attachments",
        legacyObsImgDir: "Linux.do/attachments",
        obsImgDirKind: OBS_IMG_DIR_KIND.RELATIVE,
        obsApiUrl: "https://127.0.0.1:27124",
        obsApiKey: "",
    };

    function normalizeExportTemplate(template) {
        return String(template || "").toLowerCase() === "clean" ? "clean" : DEFAULTS.exportTemplate;
    }

    function normalizeCaseKey(value) {
        return String(value || "").trim().toLowerCase();
    }

    function normalizeVaultPath(value) {
        return String(value || "")
            .replace(/\\/g, "/")
            .split("/")
            .map((segment) => String(segment || "").trim())
            .filter(Boolean)
            .join("/");
    }

    function hasUnsafePathSegments(path) {
        return normalizeVaultPath(path)
            .split("/")
            .filter(Boolean)
            .some((segment) => segment === "." || segment === "..");
    }

    function joinVaultPath(...parts) {
        return parts
            .map((part) => normalizeVaultPath(part))
            .filter(Boolean)
            .join("/");
    }

    function normalizeRootName(value) {
        const normalized = normalizeVaultPath(value);
        if (!normalized || hasUnsafePathSegments(normalized)) return "";
        return normalized;
    }

    function normalizeCategoryName(value) {
        const raw = String(value || "").trim();
        if (!raw || /[\\/]/.test(raw) || raw === "." || raw === "..") return "";
        return raw;
    }

    function normalizeImageDirValue(value) {
        const normalized = normalizeVaultPath(value);
        if (!normalized || hasUnsafePathSegments(normalized)) return "";
        return normalized;
    }

    function readStoredStringList(key, fallback) {
        const raw = GM_getValue(key, fallback);
        if (Array.isArray(raw)) return raw;
        if (typeof raw === "string") {
            const trimmed = raw.trim();
            if (!trimmed) return [];
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed;
            } catch {
                // ignore non-JSON string payloads
            }
            return trimmed.split(/[\r\n,]+/g).map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }

    function normalizeStoredNameList(rawList, normalizer, fallbackList) {
        const result = [];
        const seen = new Set();
        for (const item of [...(Array.isArray(rawList) ? rawList : []), ...(Array.isArray(fallbackList) ? fallbackList : [fallbackList])]) {
            const normalized = normalizer(item);
            if (!normalized) continue;
            const key = normalizeCaseKey(normalized);
            if (seen.has(key)) continue;
            seen.add(key);
            result.push(normalized);
        }
        return result;
    }

    function pickStoredName(preferred, list, normalizer, fallbackValue) {
        const preferredKey = normalizeCaseKey(normalizer(preferred));
        if (preferredKey) {
            const preferredMatch = list.find((item) => normalizeCaseKey(item) === preferredKey);
            if (preferredMatch) return preferredMatch;
        }
        const fallbackKey = normalizeCaseKey(normalizer(fallbackValue));
        if (fallbackKey) {
            const fallbackMatch = list.find((item) => normalizeCaseKey(item) === fallbackKey);
            if (fallbackMatch) return fallbackMatch;
        }
        return list[0] || normalizer(fallbackValue) || "";
    }

    function isPathInside(basePath, targetPath) {
        const base = normalizeVaultPath(basePath);
        const target = normalizeVaultPath(targetPath);
        if (!base || !target) return false;

        const baseLower = normalizeCaseKey(base);
        const targetLower = normalizeCaseKey(target);
        return targetLower === baseLower || targetLower.startsWith(`${baseLower}/`);
    }

    function stripBasePath(basePath, targetPath) {
        const base = normalizeVaultPath(basePath);
        const target = normalizeVaultPath(targetPath);
        if (!isPathInside(base, target)) return "";

        const baseParts = base.split("/").filter(Boolean);
        const targetParts = target.split("/").filter(Boolean);
        return targetParts.slice(baseParts.length).join("/");
    }

    function buildNormalizedObsidianStorageConfig(input) {
        const roots = normalizeStoredNameList(input?.roots, normalizeRootName, DEFAULTS.obsRoots);
        const categories = normalizeStoredNameList(input?.categories, normalizeCategoryName, DEFAULTS.obsCategories);
        const currentRoot = pickStoredName(input?.currentRoot, roots, normalizeRootName, roots[0] || DEFAULTS.obsRoot);
        const currentCategory = pickStoredName(
            input?.currentCategory,
            categories,
            normalizeCategoryName,
            DEFAULTS.obsCategory
        );

        let imgDirKind = input?.imgDirKind === OBS_IMG_DIR_KIND.LEGACY
            ? OBS_IMG_DIR_KIND.LEGACY
            : OBS_IMG_DIR_KIND.RELATIVE;
        let imgDirRaw = imgDirKind === OBS_IMG_DIR_KIND.LEGACY
            ? normalizeVaultPath(input?.imgDirRaw)
            : normalizeImageDirValue(input?.imgDirRaw);

        if (!imgDirRaw) {
            imgDirRaw = imgDirKind === OBS_IMG_DIR_KIND.LEGACY
                ? DEFAULTS.legacyObsImgDir
                : DEFAULTS.obsImgDir;
        }
        if (hasUnsafePathSegments(imgDirRaw)) {
            imgDirKind = OBS_IMG_DIR_KIND.RELATIVE;
            imgDirRaw = DEFAULTS.obsImgDir;
        }

        return {
            roots,
            currentRoot,
            categories,
            currentCategory,
            imgDirRaw,
            imgDirKind,
        };
    }

    function persistObsidianStorageConfig(config) {
        const normalized = buildNormalizedObsidianStorageConfig(config);
        GM_setValue(K.OBS_ROOTS, normalized.roots);
        GM_setValue(K.OBS_ROOT, normalized.currentRoot);
        GM_setValue(K.OBS_CATEGORIES, normalized.categories);
        GM_setValue(K.OBS_CATEGORY, normalized.currentCategory);
        GM_setValue(K.OBS_IMG_DIR, normalized.imgDirRaw);
        GM_setValue(K.OBS_IMG_DIR_KIND, normalized.imgDirKind);
        GM_setValue(K.OBS_CONFIG_VERSION, 2);
        return normalized;
    }

    function migrateObsidianStorageConfig() {
        const legacyRoot = normalizeRootName(GM_getValue(K.OBS_DIR, DEFAULTS.obsDir)) || DEFAULTS.obsRoot;
        const storedRoots = readStoredStringList(K.OBS_ROOTS, []);
        const storedCategories = readStoredStringList(K.OBS_CATEGORIES, []);
        const roots = normalizeStoredNameList(storedRoots, normalizeRootName, [legacyRoot, DEFAULTS.obsRoot]);
        const categories = normalizeStoredNameList(storedCategories, normalizeCategoryName, DEFAULTS.obsCategories);

        const currentRoot = pickStoredName(
            GM_getValue(K.OBS_ROOT, legacyRoot),
            roots,
            normalizeRootName,
            legacyRoot
        );
        const currentCategory = pickStoredName(
            GM_getValue(K.OBS_CATEGORY, DEFAULTS.obsCategory),
            categories,
            normalizeCategoryName,
            DEFAULTS.obsCategory
        );

        const storedImgDir = GM_getValue(K.OBS_IMG_DIR, DEFAULTS.legacyObsImgDir);
        const normalizedStoredImgDir = normalizeVaultPath(storedImgDir);
        let imgDirRaw = DEFAULTS.obsImgDir;
        let imgDirKind = OBS_IMG_DIR_KIND.RELATIVE;

        if (normalizedStoredImgDir) {
            if (isPathInside(legacyRoot, normalizedStoredImgDir)) {
                imgDirRaw = stripBasePath(legacyRoot, normalizedStoredImgDir) || DEFAULTS.obsImgDir;
            } else {
                imgDirRaw = normalizedStoredImgDir;
                imgDirKind = OBS_IMG_DIR_KIND.LEGACY;
            }
        }

        return persistObsidianStorageConfig({
            roots,
            currentRoot,
            categories,
            currentCategory,
            imgDirRaw,
            imgDirKind,
        });
    }

    function getStoredObsidianConfig() {
        const version = clampInt(GM_getValue(K.OBS_CONFIG_VERSION, 0), 0, 999, 0);
        const hasV2Keys =
            Array.isArray(GM_getValue(K.OBS_ROOTS, null)) &&
            Array.isArray(GM_getValue(K.OBS_CATEGORIES, null)) &&
            !!GM_getValue(K.OBS_ROOT, "") &&
            !!GM_getValue(K.OBS_CATEGORY, "");

        if (version < 2 || !hasV2Keys) {
            return migrateObsidianStorageConfig();
        }

        return persistObsidianStorageConfig({
            roots: readStoredStringList(K.OBS_ROOTS, DEFAULTS.obsRoots),
            currentRoot: GM_getValue(K.OBS_ROOT, DEFAULTS.obsRoot),
            categories: readStoredStringList(K.OBS_CATEGORIES, DEFAULTS.obsCategories),
            currentCategory: GM_getValue(K.OBS_CATEGORY, DEFAULTS.obsCategory),
            imgDirRaw: GM_getValue(K.OBS_IMG_DIR, DEFAULTS.obsImgDir),
            imgDirKind: GM_getValue(K.OBS_IMG_DIR_KIND, DEFAULTS.obsImgDirKind),
        });
    }

    function resolveObsidianPaths(config) {
        const normalized = buildNormalizedObsidianStorageConfig(config);
        const dir = joinVaultPath(normalized.currentRoot, normalized.currentCategory);
        const imgDir = normalized.imgDirKind === OBS_IMG_DIR_KIND.LEGACY
            ? normalizeVaultPath(normalized.imgDirRaw)
            : joinVaultPath(normalized.currentRoot, normalized.imgDirRaw || DEFAULTS.obsImgDir);

        return {
            root: normalized.currentRoot,
            category: normalized.currentCategory,
            dir,
            imgDirRaw: normalized.imgDirRaw,
            imgDirKind: normalized.imgDirKind,
            imgDir,
        };
    }

    function sanitizeTopicFilenameTitle(title) {
        return String(title || "untitled")
            .replace(/[\\/:*?"<>|]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "untitled";
    }

    function buildMarkdownFilename(topic) {
        const safeTitle = sanitizeTopicFilenameTitle(topic?.title || "untitled");
        const topicId = String(topic?.topicId || "").trim();
        return topicId ? `${safeTitle}-${topicId}.md` : `${safeTitle}.md`;
    }

    function cloneExportSettings(settings) {
        return {
            ...settings,
            filters: { ...(settings?.filters || {}) },
            ai: { ...(settings?.ai || {}) },
            obsidian: { ...(settings?.obsidian || {}) },
        };
    }

    function buildTargetExportSettings(settings, target) {
        const cloned = cloneExportSettings(settings);
        if ((target || "") === "markdown") {
            cloned.obsidian.imgMode = "base64";
        }
        return cloned;
    }

    function extractTopicIdFromText(content) {
        const source = String(content || "");
        if (!source) return "";

        const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        const scope = frontmatterMatch ? frontmatterMatch[1] : source;
        const match = scope.match(/(?:^|\n)topic_id:\s*["']?(\d+)["']?(?:\s*(?:\n|$))/i);
        return match ? String(match[1]) : "";
    }

    function extractTopicIdFromNoteJson(noteJson) {
        const topicId = noteJson?.frontmatter?.topic_id;
        if (topicId !== undefined && topicId !== null && String(topicId).trim()) {
            return String(topicId).trim();
        }
        return extractTopicIdFromText(noteJson?.content || "");
    }

    // -----------------------
    // Emoji 名称到 Unicode 映射
    // -----------------------
    const EMOJI_MAP = {
        // 笑脸表情
        grinning_face: "😀", smiley: "😃", grinning_face_with_smiling_eyes: "😄", grin: "😁",
        laughing: "😆", sweat_smile: "😅", rofl: "🤣", joy: "😂",
        slightly_smiling_face: "🙂", upside_down_face: "🙃", melting_face: "🫠",
        wink: "😉", blush: "😊", innocent: "😇",
        smiling_face_with_three_hearts: "🥰", heart_eyes: "😍", star_struck: "🤩",
        face_blowing_a_kiss: "😘", kissing_face: "😗", smiling_face: "☺️",
        kissing_face_with_closed_eyes: "😚", kissing_face_with_smiling_eyes: "😙",
        smiling_face_with_tear: "🥲",
        // 舌头表情
        face_savoring_food: "😋", face_with_tongue: "😛", winking_face_with_tongue: "😜",
        zany_face: "🤪", squinting_face_with_tongue: "😝", money_mouth_face: "🤑",
        // 手势类表情
        hugs: "🤗", face_with_hand_over_mouth: "🤭", face_with_open_eyes_and_hand_over_mouth: "🫢",
        face_with_peeking_eye: "🫣", shushing_face: "🤫", thinking: "🤔", saluting_face: "🫡",
        // 嘴部表情
        zipper_mouth_face: "🤐", face_with_raised_eyebrow: "🤨", neutral_face: "😐",
        expressionless: "😑", expressionless_face: "😑", face_without_mouth: "😶",
        dotted_line_face: "🫥", face_in_clouds: "😶‍🌫️",
        // 斜眼表情
        smirk: "😏", smirking_face: "😏", unamused: "😒", unamused_face: "😒",
        roll_eyes: "🙄", rolling_eyes: "🙄", grimacing: "😬", face_exhaling: "😮‍💨",
        lying_face: "🤥", shaking_face: "🫨",
        head_shaking_horizontally: "🙂‍↔️", head_shaking_vertically: "🙂‍↕️",
        // 疲惫表情
        relieved: "😌", relieved_face: "😌", pensive: "😔", pensive_face: "😔",
        sleepy: "😪", sleepy_face: "😪", drooling_face: "🤤", sleeping: "😴", sleeping_face: "😴",
        face_with_bags_under_eyes: "🫩",
        // 生病表情
        mask: "😷", face_with_medical_mask: "😷", face_with_thermometer: "🤒",
        face_with_head_bandage: "🤕", nauseated_face: "🤢", face_vomiting: "🤮",
        sneezing_face: "🤧", hot_face: "🥵", cold_face: "🥶", woozy_face: "🥴",
        face_with_crossed_out_eyes: "😵", face_with_spiral_eyes: "😵‍💫", exploding_head: "🤯",
        // 帽子和眼镜表情
        cowboy_hat_face: "🤠", face_with_cowboy_hat: "🤠", partying_face: "🥳", disguised_face: "🥸",
        sunglasses: "😎", smiling_face_with_sunglasses: "😎", nerd_face: "🤓", face_with_monocle: "🧐",
        // 困惑表情
        confused: "😕", face_with_diagonal_mouth: "🫤", worried: "😟",
        slightly_frowning_face: "🙁", frowning: "☹️",
        // 惊讶表情
        open_mouth: "😮", hushed_face: "😯", astonished_face: "😲", flushed_face: "😳",
        distorted_face: "🫨", pleading_face: "🥺", face_holding_back_tears: "🥹",
        frowning_face_with_open_mouth: "😦", anguished_face: "😧",
        // 恐惧表情
        fearful: "😨", anxious_face_with_sweat: "😰", sad_but_relieved_face: "😥",
        cry: "😢", sob: "😭", scream: "😱",
        confounded: "😖", confounded_face: "😖", persevering_face: "😣",
        disappointed: "😞", disappointed_face: "😞", sweat: "😓", downcast_face_with_sweat: "😓",
        weary_face: "😩", tired_face: "😫", yawning_face: "🥱",
        // 愤怒表情
        face_with_steam_from_nose: "😤", enraged_face: "😡", angry: "😠", rage: "😡",
        face_with_symbols_on_mouth: "🤬",
        smiling_face_with_horns: "😈", angry_face_with_horns: "👿",
        // 骷髅和怪物
        skull: "💀", skull_and_crossbones: "☠️", poop: "💩", clown_face: "🤡",
        ogre: "👹", goblin: "👺", ghost: "👻", alien: "👽", alien_monster: "👾", robot: "🤖",
        // 猫咪表情
        grinning_cat: "😺", grinning_cat_with_smiling_eyes: "😸", joy_cat: "😹",
        smiling_cat_with_heart_eyes: "😻", cat_with_wry_smile: "😼", kissing_cat: "😽",
        weary_cat: "🙀", crying_cat: "😿", pouting_cat: "😾",
        // 三猴子
        see_no_evil_monkey: "🙈", hear_no_evil_monkey: "🙉", speak_no_evil_monkey: "🙊",
        // 心形类
        love_letter: "💌", heart_with_arrow: "💘", heart_with_ribbon: "💝",
        sparkling_heart: "💖", growing_heart: "💗", beating_heart: "💓",
        revolving_hearts: "💞", two_hearts: "💕", heart_decoration: "💟",
        heart_exclamation: "❣️", broken_heart: "💔", heart_on_fire: "❤️‍🔥", mending_heart: "❤️‍🩹",
        heart: "❤️", pink_heart: "🩷", orange_heart: "🧡", yellow_heart: "💛",
        green_heart: "💚", blue_heart: "💙", light_blue_heart: "🩵", purple_heart: "💜",
        brown_heart: "🤎", black_heart: "🖤", grey_heart: "🩶", white_heart: "🤍",
        // 符号类
        kiss_mark: "💋", "100": "💯", anger_symbol: "💢", fight_cloud: "💨",
        collision: "💥", dizzy: "💫", sweat_droplets: "💦", sweat_drops: "💦",
        dashing_away: "💨", dash: "💨", hole: "🕳️",
        speech_balloon: "💬", eye_in_speech_bubble: "👁️️🗨️", left_speech_bubble: "🗨️",
        right_anger_bubble: "🗯️", thought_balloon: "💭", zzz: "💤",
        // 兼容旧版本的别名
        smile: "😊", grinning: "😀", kissing: "😗", kissing_heart: "😘",
        stuck_out_tongue: "😛", heartpulse: "💗", heartbeat: "💓", cupid: "💘", gift_heart: "💝",
        // 手势
        thumbsup: "👍", thumbsdown: "👎", "+1": "👍", "-1": "👎",
        ok_hand: "👌", punch: "👊", fist: "✊", v: "✌️", wave: "👋",
        raised_hand: "✋", open_hands: "👐", muscle: "💪", pray: "🙏",
        point_up: "☝️", point_up_2: "👆", point_down: "👇", point_left: "👈", point_right: "👉",
        clap: "👏", raised_hands: "🙌", handshake: "🤝",
        // 通用符号
        star: "⭐", star2: "🌟", sparkles: "✨", zap: "⚡", fire: "🔥",
        boom: "💥", droplet: "💧",
        check: "✅", white_check_mark: "✅", x: "❌", cross_mark: "❌",
        heavy_check_mark: "✔️", heavy_multiplication_x: "✖️",
        question: "❓", exclamation: "❗", warning: "⚠️", no_entry: "⛔",
        triangular_flag: "🚩", triangular_flag_on_post: "🚩",
        sos: "🆘", ok: "🆗", cool: "🆒", new: "🆕", free: "🆓",
        // 动物
        dog: "🐕", cat: "🐈", mouse: "🐁", rabbit: "🐇", bear: "🐻",
        panda_face: "🐼", koala: "🐨", tiger: "🐯", lion: "🦁", cow: "🐄",
        pig: "🐷", monkey: "🐒", chicken: "🐔", penguin: "🐧", bird: "🐦",
        frog: "🐸", turtle: "🐢", snake: "🐍", dragon: "🐉", whale: "🐋",
        dolphin: "🐬", fish: "🐟", octopus: "🐙", bug: "🐛", bee: "🐝",
        // 食物
        apple: "🍎", green_apple: "🍏", banana: "🍌", orange: "🍊", lemon: "🍋",
        grapes: "🍇", watermelon: "🍉", strawberry: "🍓", peach: "🍑", cherries: "🍒",
        pizza: "🍕", hamburger: "🍔", fries: "🍟", hotdog: "🌭", taco: "🌮",
        coffee: "☕", tea: "🍵", beer: "🍺", wine_glass: "🍷", tropical_drink: "🍹",
        cake: "🍰", cookie: "🍪", chocolate_bar: "🍫", candy: "🍬", lollipop: "🍭",
        // 物品
        gift: "🎁", balloon: "🎈", tada: "🎉", confetti_ball: "🎊",
        trophy: "🏆", medal: "🏅", first_place_medal: "🥇", second_place_medal: "🥈", third_place_medal: "🥉",
        soccer: "⚽", basketball: "🏀", football: "🏈", tennis: "🎾", volleyball: "🏐",
        computer: "💻", keyboard: "⌨️", desktop_computer: "🖥️", printer: "🖨️", mouse_three_button: "🖱️",
        phone: "📱", telephone: "☎️", email: "📧", envelope: "✉️", memo: "📝",
        book: "📖", books: "📚", newspaper: "📰", bookmark: "🔖",
        bulb: "💡", flashlight: "🔦", candle: "🕯️",
        lock: "🔒", unlock: "🔓", key: "🔑",
        // 交通与天气
        rocket: "🚀", airplane: "✈️", car: "🚗", bus: "🚌", train: "🚆",
        sun: "☀️", cloud: "☁️", umbrella: "☂️", rainbow: "🌈", snowflake: "❄️",
        clock: "🕐", alarm_clock: "⏰", stopwatch: "⏱️", timer_clock: "⏲️",
        hourglass: "⌛", watch: "⌚",
        globe_showing_americas: "🌎", globe_showing_europe_africa: "🌍", globe_showing_asia_australia: "🌏",
        earth_americas: "🌎", earth_africa: "🌍", earth_asia: "🌏",
        bullseye: "🎯", dart: "🎯",
        // 国旗
        cn: "🇨🇳", us: "🇺🇸", jp: "🇯🇵", kr: "🇰🇷", gb: "🇬🇧",
    };

    // -----------------------
    // 工具函数
    // -----------------------
    function getTopicId() {
        const m =
            window.location.pathname.match(/\/topic\/(\d+)/) ||
            window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
        return m ? m[1] : null;
    }

    function absoluteUrl(src) {
        if (!src) return "";
        if (src.startsWith("http://") || src.startsWith("https://")) return src;
        if (src.startsWith("//")) return window.location.protocol + src;
        if (src.startsWith("/")) return window.location.origin + src;
        return window.location.origin + "/" + src.replace(/^\.?\//, "");
    }

    function clampInt(n, min, max, fallback) {
        const x = parseInt(String(n), 10);
        if (Number.isNaN(x)) return fallback;
        return Math.max(min, Math.min(max, x));
    }

    function normalizeListInput(s) {
        return (s || "")
            .split(/[\s,，;；]+/g)
            .map((x) => x.trim())
            .filter(Boolean);
    }

    function sleep(ms) {
        return new Promise((r) => setTimeout(r, ms));
    }

    function getDiscourseEmojiName(src) {
        const match = String(src || "").match(/\/images\/emoji\/(?:twemoji|apple|google|twitter)\/([^/.]+)\.png/i);
        return match ? match[1] : "";
    }

    function isDiscourseEmojiImage(src) {
        return !!getDiscourseEmojiName(src);
    }

    function encodeVaultPath(path) {
        return String(path || "")
            .split("/")
            .map((segment) => encodeURIComponent(segment))
            .join("/");
    }

    function normalizeObsidianApiUrl(url) {
        const raw = String(url || DEFAULTS.obsApiUrl).trim() || DEFAULTS.obsApiUrl;
        try {
            const parsed = new URL(raw);
            parsed.hash = "";
            parsed.search = "";
            return parsed.toString().replace(/\/+$/g, "");
        } catch {
            return raw.replace(/\/+$/g, "");
        }
    }

    function normalizeAiApiBaseUrl(url) {
        const raw = String(url || "").trim();
        if (!raw) return "";

        const stripEndpoint = (value) =>
            value
                .replace(/\/+$/g, "")
                .replace(/\/chat\/completions$/i, "")
                .replace(/\/v1\/chat\/completions$/i, "/v1")
                .replace(/\/+$/g, "");

        try {
            const parsed = new URL(raw);
            parsed.hash = "";
            parsed.search = "";
            return stripEndpoint(parsed.toString());
        } catch {
            return stripEndpoint(raw);
        }
    }

    function isLoopbackHost(hostname) {
        const host = String(hostname || "").toLowerCase();
        return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
    }

    function getObsidianFallbackApiUrl(apiUrl) {
        try {
            const parsed = new URL(apiUrl);
            if (parsed.protocol !== "https:") return "";
            if (parsed.port !== "27124") return "";
            if (!isLoopbackHost(parsed.hostname)) return "";
            if (parsed.pathname && parsed.pathname !== "/") return "";

            parsed.protocol = "http:";
            parsed.port = "27123";
            parsed.pathname = "/";
            parsed.hash = "";
            parsed.search = "";
            return parsed.toString().replace(/\/+$/g, "");
        } catch {
            return "";
        }
    }

    function joinObsidianUrl(baseUrl, path) {
        const normalizedBase = normalizeObsidianApiUrl(baseUrl);
        const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path}`;
        return `${normalizedBase}${normalizedPath}`;
    }

    function joinAiApiUrl(baseUrl, path) {
        const normalizedBase = normalizeAiApiBaseUrl(baseUrl);
        const normalizedPath = String(path || "").startsWith("/") ? String(path || "") : `/${path}`;
        return `${normalizedBase}${normalizedPath}`;
    }

    function mergeHeaders(baseHeaders, extraHeaders) {
        const headers = new Headers(baseHeaders || {});
        const extras = new Headers(extraHeaders || {});
        extras.forEach((value, key) => headers.set(key, value));
        return headers;
    }

    function persistObsidianApiUrl(apiUrl) {
        const normalized = normalizeObsidianApiUrl(apiUrl);
        GM_setValue(K.OBS_API_URL, normalized);
        if (ui.inputObsApiUrl) ui.inputObsApiUrl.value = normalized;
        return normalized;
    }

    function persistAiApiUrl(apiUrl) {
        const normalized = normalizeAiApiBaseUrl(apiUrl);
        GM_setValue(K.AI_API_URL, normalized);
        if (ui.inputAiApiUrl) ui.inputAiApiUrl.value = normalized;
        return normalized;
    }

    function isFetchNetworkError(error) {
        const msg = String(error?.message || "").toLowerCase();
        return error instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|certificate|ssl|tls|trust/.test(msg);
    }

    function createObsidianNetworkError(apiUrl, canFallback, cause) {
        const error = new Error(
            canFallback
                ? `HTTPS 证书未受信或本地服务不可达：${apiUrl}`
                : `无法连接到 Obsidian API：${apiUrl}`
        );
        error.name = "ObsidianNetworkError";
        error.apiUrl = apiUrl;
        error.canFallback = canFallback;
        error.cause = cause;
        return error;
    }

    async function requestObsidian(endpointPath, init, settings) {
        const apiUrl = normalizeObsidianApiUrl(settings?.obsidian?.apiUrl || DEFAULTS.obsApiUrl);
        const apiKey = settings?.obsidian?.apiKey || "";

        if (!apiKey) throw new Error("请先配置 Obsidian API Key");

        const fallbackApiUrl = getObsidianFallbackApiUrl(apiUrl);
        const candidateApiUrls = fallbackApiUrl && fallbackApiUrl !== apiUrl
            ? [apiUrl, fallbackApiUrl]
            : [apiUrl];

        let lastError = null;

        for (let i = 0; i < candidateApiUrls.length; i += 1) {
            const candidateApiUrl = candidateApiUrls[i];

            try {
                const response = await fetch(joinObsidianUrl(candidateApiUrl, endpointPath), {
                    ...init,
                    headers: mergeHeaders(init?.headers, {
                        Authorization: `Bearer ${apiKey}`,
                    }),
                });

                if (candidateApiUrl !== apiUrl) {
                    const savedApiUrl = persistObsidianApiUrl(candidateApiUrl);
                    if (settings?.obsidian) settings.obsidian.apiUrl = savedApiUrl;
                }

                return {
                    response,
                    effectiveApiUrl: candidateApiUrl,
                    fallbackUsed: candidateApiUrl !== apiUrl,
                };
            } catch (error) {
                lastError = error;
                if (!isFetchNetworkError(error)) throw error;
                if (i < candidateApiUrls.length - 1) continue;
            }
        }

        throw createObsidianNetworkError(apiUrl, !!fallbackApiUrl, lastError);
    }

    // -----------------------
    // DOM -> Markdown
    // -----------------------
    function cookedToMarkdown(cookedHtml, settings, imgMap) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(cookedHtml || "", "text/html");
        const root = doc.body;

        function getTableAlign(cell) {
            const alignAttr = (cell.getAttribute("align") || "").toLowerCase();
            if (alignAttr === "left" || alignAttr === "center" || alignAttr === "right") return alignAttr;
            const style = cell.getAttribute("style") || "";
            const match = style.match(/text-align\s*:\s*(left|center|right)/i);
            return match ? match[1].toLowerCase() : "";
        }

        function alignToSeparator(align) {
            if (align === "left") return ":---";
            if (align === "center") return ":---:";
            if (align === "right") return "---:";
            return "---";
        }

        function escapeTableCell(text) {
            return (text || "")
                .replace(/\r\n/g, "\n")
                .replace(/\n+/g, "<br>")
                .replace(/\|/g, "\\|")
                .replace(/\s+/g, " ")
                .trim();
        }

        function tableRowCells(rowEl) {
            return Array.from(rowEl.children).filter((c) => {
                const t = c.tagName ? c.tagName.toLowerCase() : "";
                return t === "td" || t === "th";
            });
        }

        function tableToMarkdown(tableEl) {
            const headRows = Array.from(tableEl.querySelectorAll("thead tr"));
            const bodyRows = Array.from(tableEl.querySelectorAll("tbody tr"));

            let headerCells = [];
            let alignments = [];
            let dataRows = [];

            if (headRows.length) {
                const firstHead = tableRowCells(headRows[0]);
                headerCells = firstHead.map((cell) => {
                    const raw = Array.from(cell.childNodes).map((c) => serialize(c, false)).join("");
                    return escapeTableCell(raw);
                });
                alignments = firstHead.map((cell) => getTableAlign(cell));
                for (let i = 1; i < headRows.length; i += 1) {
                    const cells = tableRowCells(headRows[i]).map((cell) => {
                        const raw = Array.from(cell.childNodes).map((c) => serialize(c, false)).join("");
                        return escapeTableCell(raw);
                    });
                    dataRows.push(cells);
                }
            } else {
                const allRows = bodyRows.length ? bodyRows : Array.from(tableEl.querySelectorAll("tr"));
                if (!allRows.length) return "";
                const firstRow = allRows.shift();
                const firstCells = tableRowCells(firstRow);
                headerCells = firstCells.map((cell) => {
                    const raw = Array.from(cell.childNodes).map((c) => serialize(c, false)).join("");
                    return escapeTableCell(raw);
                });
                alignments = firstCells.map((cell) => getTableAlign(cell));
                dataRows = allRows.map((row) =>
                    tableRowCells(row).map((cell) => {
                        const raw = Array.from(cell.childNodes).map((c) => serialize(c, false)).join("");
                        return escapeTableCell(raw);
                    })
                );
            }

            if (headRows.length) {
                dataRows = dataRows.concat(
                    bodyRows.map((row) =>
                        tableRowCells(row).map((cell) => {
                            const raw = Array.from(cell.childNodes).map((c) => serialize(c, false)).join("");
                            return escapeTableCell(raw);
                        })
                    )
                );
            }

            const allRows = [headerCells, ...dataRows];
            const colCount = Math.max(0, ...allRows.map((r) => r.length));
            if (!colCount) return "";

            const padRow = (cells) => {
                const out = cells.slice(0, colCount);
                while (out.length < colCount) out.push("");
                return out;
            };

            const headerLine = `| ${padRow(headerCells).join(" | ")} |`;
            const sepLine = `| ${padRow(alignments).map((a) => alignToSeparator(a)).join(" | ")} |`;
            const bodyLines = dataRows.map((row) => `| ${padRow(row).join(" | ")} |`).join("\n");

            return [headerLine, sepLine, bodyLines].filter(Boolean).join("\n");
        }

        function serialize(node, inPre = false) {
            if (!node) return "";
            if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
            if (node.nodeType !== Node.ELEMENT_NODE) return "";

            const el = node;
            const tag = el.tagName.toLowerCase();

            if (el.classList && el.classList.contains("meta")) {
                return "";
            }

            if (tag === "aside" && el.classList.contains("quote")) {
                const titleLink = el.querySelector(".quote-title__text-content a") || el.querySelector(".title > a");
                const title = titleLink?.textContent?.trim() || "引用";
                const href = titleLink?.getAttribute("href") || "";

                const blockquote = el.querySelector("blockquote");
                const content = blockquote
                    ? Array.from(blockquote.childNodes).map((c) => serialize(c, inPre)).join("").trim()
                    : "";

                const header = href ? `[${title}](${absoluteUrl(href)})` : title;
                const lines = content.split("\n").filter((l) => l.trim());
                return "\n> [!quote] " + header + "\n" + lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            }

            if (tag === "aside" && el.classList.contains("onebox")) {
                const titleEl = el.querySelector("h3 a") || el.querySelector("header a");
                const title = titleEl?.textContent?.trim() || "";
                const href = titleEl?.getAttribute("href") || "";
                const desc = el.querySelector("article p")?.textContent?.trim() || "";

                if (href) {
                    const link = `[${title || href}](${absoluteUrl(href)})`;
                    if (desc) {
                        return `\n> [!info] ${link}\n> ${desc}\n\n`;
                    }
                    return `\n${link}\n`;
                }
                return "";
            }

            if (tag === "br") return "\n";

            if (tag === "img") {
                const src = el.getAttribute("src") || el.getAttribute("data-src") || "";
                const emojiName = getDiscourseEmojiName(src);
                if (emojiName) {
                    if (EMOJI_MAP[emojiName]) {
                        return EMOJI_MAP[emojiName];
                    }
                    const emojiAlt = el.getAttribute("alt") || el.getAttribute("title") || "";
                    if (emojiAlt && emojiAlt.length <= 4) {
                        return emojiAlt;
                    }
                    return `:${emojiName}:`;
                }

                const full = absoluteUrl(src);
                if (!full) return "";

                if (settings.obsidian && settings.obsidian.imgMode === "none") {
                    return "";
                }

                const alt = "图片";

                if (settings.obsidian && settings.obsidian.imgMode === "file" && imgMap && imgMap[full]) {
                    const filename = imgMap[full];
                    return `\n![[${filename}]]\n`;
                } else if (settings.obsidian && settings.obsidian.imgMode === "base64" && imgMap && imgMap[full]) {
                    return `\n![${alt}](${imgMap[full]})\n`;
                } else {
                    return `\n![${alt}](${full})\n`;
                }
            }

            if (tag === "a") {
                const href = el.getAttribute("href") || "";
                const classes = el.getAttribute("class") || "";
                if (classes.includes("anchor") || href.startsWith("#")) {
                    const childContent = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                    return childContent;
                }
                const hasImg = el.querySelector("img");
                if (hasImg) {
                    return Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                }
                const text = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                const link = absoluteUrl(href);
                if (!link) return text;
                if (!text) return link;
                if (text === link) return `<${text}>`;
                return `[${text}](${link})`;
            }

            if (tag === "pre") {
                const codeEl = el.querySelector("code");
                const langClass = codeEl?.getAttribute("class") || "";
                const lang = (langClass.match(/lang(?:uage)?-([a-z0-9_+-]+)/i) || [])[1] || "";
                const code = (codeEl ? codeEl.textContent : el.textContent) || "";
                return `\n\`\`\`${lang}\n${code.replace(/\n+$/g, "")}\n\`\`\`\n\n`;
            }

            if (tag === "code") {
                if (inPre) return el.textContent || "";
                const t = (el.textContent || "").replace(/\n/g, " ");
                return t ? `\`${t}\`` : "";
            }

            if (tag === "blockquote") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                const lines = inner.trim().split("\n");
                return "\n" + lines.map((l) => `> ${l}`).join("\n") + "\n\n";
            }

            if (/^h[1-6]$/.test(tag)) {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                return inner ? `\n**${inner}**\n\n` : "";
            }

            if (tag === "li") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                return inner ? `- ${inner}\n` : "";
            }

            if (tag === "ul" || tag === "ol") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                return `\n${inner}\n`;
            }

            if (tag === "p") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("").trim();
                return inner ? `${inner}\n\n` : "\n";
            }

            if (tag === "strong" || tag === "b") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                return `**${inner}**`;
            }

            if (tag === "em" || tag === "i") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                return `*${inner}*`;
            }

            if (tag === "s" || tag === "del" || tag === "strike") {
                const inner = Array.from(el.childNodes).map((c) => serialize(c, inPre)).join("");
                return `~~${inner}~~`;
            }

            if (tag === "table") {
                const tableMd = tableToMarkdown(el);
                return tableMd ? `\n${tableMd}\n\n` : "";
            }

            const nextInPre = inPre || tag === "pre";
            return Array.from(el.childNodes).map((c) => serialize(c, nextInPre)).join("");
        }

        let text = Array.from(root.childNodes).map((n) => serialize(n, false)).join("");
        text = text.replace(/\r\n/g, "\n");
        text = text.replace(/[ \t]+\n/g, "\n");
        text = text.replace(/\n{3,}/g, "\n\n");
        text = text.replace(/^[ \t]+\[/gm, "[");
        return text.trim();
    }

    // -----------------------
    // Panel UI
    // -----------------------
    const ui = {
        panelRoot: null,
        bubbleRoot: null,
        shell: null,
        bubbleBtn: null,
        bubbleLabel: null,
        btnCollapsePanel: null,
        btnObsidianToggle: null,
        obsidianArrow: null,
        btnTemplateToggle: null,
        templateArrow: null,
        statusCard: null,
        progressBar: null,
        progressText: null,
        statusText: null,
        btnMarkdown: null,
        btnObsidian: null,
        btnTestConnection: null,
        selExportTemplate: null,
        templateCleanHint: null,
        exportStyleWrap: null,
        exportStyleFiltersWrap: null,

        selRangeMode: null,
        inputRangeStart: null,
        inputRangeEnd: null,

        chkOnlyOp: null,
        selImgFilter: null,
        inputUsers: null,
        inputInclude: null,
        inputExclude: null,
        inputMinLen: null,
        chkAiFilter: null,
        aiSettingsWrap: null,
        inputAiApiUrl: null,
        inputAiApiKey: null,
        inputAiModelId: null,

        obsidianWrap: null,

        inputObsApiUrl: null,
        inputObsApiKey: null,
        selObsRoot: null,
        btnAddObsRoot: null,
        btnManageObsRoots: null,
        selObsCategory: null,
        btnAddObsCategory: null,
        btnManageObsCategories: null,
        obsOverviewNote: null,
        selObsImgMode: null,
        obsImgDirWrap: null,
        inputObsImgDir: null,
        obsImgPreviewNote: null,

        obsidianConfig: null,
        isBusy: false,
        obsOverviewRefreshSeq: 0,
        obsOverviewTimer: null,
        bubbleY: null,
        bubbleSuppressClickUntil: 0,
        handleViewportResize: null,

        downloadFallbackUrl: null,
        downloadFallbackName: null,
        btnFallback: null,

        ensureStyles() {
            if (document.getElementById("ld-export-panel-style")) return;

            const style = document.createElement("style");
            style.id = "ld-export-panel-style";
            style.textContent = `
#ld-export-panel,
#ld-export-bubble-root {
  --ld-bg: #171717;
  --ld-bg-deep: #0f0f0f;
  --ld-surface: #171717;
  --ld-surface-raised: #1d1d1d;
  --ld-surface-deep: #111111;
  --ld-surface-overlay: rgba(250, 250, 250, 0.03);
  --ld-border-subtle: #242424;
  --ld-border: #2e2e2e;
  --ld-border-strong: #363636;
  --ld-text: #fafafa;
  --ld-text-secondary: #b4b4b4;
  --ld-text-muted: #898989;
  --ld-accent: #3ecf8e;
  --ld-link: #00c573;
  --ld-success: #3ecf8e;
  --ld-warning: #d1a646;
  --ld-error: #d25d78;
  --ld-focus-ring: rgba(62, 207, 142, 0.22);
  --ld-scrollbar-size: 12px;
  --ld-scrollbar-track: rgba(255, 255, 255, 0.035);
  --ld-scrollbar-thumb: rgba(109, 200, 155, 0.32);
  --ld-scrollbar-thumb-hover: rgba(125, 224, 176, 0.46);
  --ld-scrollbar-thumb-active: rgba(125, 224, 176, 0.6);
  --ld-font-sans: "Segoe UI", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif;
  --ld-font-mono: ui-monospace, "Source Code Pro", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  --ld-radius: 8px;
  --ld-pill-radius: 9999px;
  color: var(--ld-text);
  font-family: var(--ld-font-sans);
  font-size: 12px;
  line-height: 1.45;
}

#ld-export-panel {
  position: fixed;
  top: 16px;
  left: 16px;
  z-index: 99999;
}

#ld-export-bubble-root {
  position: fixed;
  right: 16px;
  top: 16px;
  z-index: 99999;
}

#ld-export-panel .ld-shell {
  width: min(360px, calc(100vw - 24px));
  display: flex;
  flex-direction: column;
  max-height: min(88vh, 820px);
  overflow: hidden;
  border-radius: var(--ld-radius);
  border: 1px solid var(--ld-border);
  background: var(--ld-surface);
}

#ld-export-panel .ld-body::-webkit-scrollbar {
  width: var(--ld-scrollbar-size);
}

#ld-export-panel .ld-body::-webkit-scrollbar-track {
  margin: 8px 0;
  border-radius: var(--ld-pill-radius);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), var(--ld-scrollbar-track));
}

#ld-export-panel .ld-body::-webkit-scrollbar-thumb {
  border: 3px solid transparent;
  border-radius: var(--ld-pill-radius);
  background: linear-gradient(180deg, var(--ld-scrollbar-thumb-hover), var(--ld-scrollbar-thumb));
  background-clip: padding-box;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
}

#ld-export-panel .ld-body::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(142, 236, 191, 0.58), var(--ld-scrollbar-thumb-hover));
  background-clip: padding-box;
}

#ld-export-panel .ld-body::-webkit-scrollbar-thumb:active {
  background: linear-gradient(180deg, rgba(154, 242, 201, 0.7), var(--ld-scrollbar-thumb-active));
  background-clip: padding-box;
}

#ld-export-panel .ld-body::-webkit-scrollbar-button {
  width: 0;
  height: 0;
  display: none;
}

#ld-export-panel .ld-body::-webkit-scrollbar-corner {
  background: transparent;
}

#ld-export-panel,
#ld-export-panel *,
#ld-export-bubble-root,
#ld-export-bubble-root * {
  box-sizing: border-box;
}

#ld-export-bubble-root .ld-bubble {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  max-width: min(320px, calc(100vw - 24px));
  padding: 10px 14px;
  border: 1px solid var(--ld-border);
  border-radius: var(--ld-pill-radius);
  background: rgba(15, 15, 15, 0.96);
  color: var(--ld-text);
  cursor: pointer;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
  touch-action: none;
  user-select: none;
}

#ld-export-bubble-root .ld-bubble[data-dragging="true"] {
  cursor: grabbing;
}

#ld-export-bubble-root .ld-bubble:hover {
  border-color: rgba(62, 207, 142, 0.3);
}

#ld-export-bubble-root .ld-bubble[data-tone="success"] {
  border-color: rgba(62, 207, 142, 0.28);
}

#ld-export-bubble-root .ld-bubble[data-tone="warning"] {
  border-color: rgba(209, 166, 70, 0.28);
}

#ld-export-bubble-root .ld-bubble-dot {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--ld-text-muted);
}

#ld-export-bubble-root .ld-bubble[data-tone="success"] .ld-bubble-dot {
  background: var(--ld-success);
}

#ld-export-bubble-root .ld-bubble[data-tone="warning"] .ld-bubble-dot {
  background: var(--ld-warning);
}

#ld-export-bubble-root .ld-bubble-label {
  display: inline-block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#ld-export-panel .ld-icon-btn {
  appearance: none;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--ld-border);
  border-radius: 999px;
  background: transparent;
  color: var(--ld-text-muted);
  cursor: pointer;
}

#ld-export-panel .ld-icon-btn:hover:not(:disabled) {
  border-color: rgba(62, 207, 142, 0.3);
  color: var(--ld-text);
}

#ld-export-panel .ld-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ld-border-subtle);
  background: var(--ld-bg-deep);
}

#ld-export-panel .ld-brand {
  display: grid;
  gap: 2px;
  min-width: 0;
}

#ld-export-panel .ld-kicker {
  color: var(--ld-text-muted);
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.3;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

#ld-export-panel .ld-title {
  color: var(--ld-text);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.25;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#ld-export-panel .ld-header-side {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

#ld-export-panel .ld-chevron,
#ld-export-panel .ld-section-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--ld-text-muted);
  line-height: 1;
  text-align: center;
}

#ld-export-panel .ld-chevron {
  min-width: 20px;
  min-height: 20px;
  font-size: 18px;
  font-weight: 700;
}

#ld-export-panel .ld-icon-close {
  display: block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  pointer-events: none;
}

#ld-export-panel .ld-section-arrow {
  min-width: 18px;
  min-height: 18px;
  font-size: 16px;
  font-weight: 700;
}

#ld-export-panel .ld-body {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
  gap: 6px;
  padding: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--ld-scrollbar-thumb) transparent;
}

#ld-export-panel .ld-status-card {
  border-radius: var(--ld-radius);
  border: 1px solid var(--ld-border);
  background: var(--ld-surface);
}

#ld-export-panel .ld-status-card {
  padding: 9px;
}

#ld-export-panel .ld-status-card[data-tone="idle"] {
  border-color: var(--ld-border);
  background: var(--ld-surface);
}

#ld-export-panel .ld-status-card[data-tone="working"] {
  border-color: var(--ld-border-strong);
  background: var(--ld-surface);
}

#ld-export-panel .ld-status-card[data-tone="success"] {
  border-color: rgba(62, 207, 142, 0.3);
  background: var(--ld-surface);
}

#ld-export-panel .ld-status-card[data-tone="warning"] {
  border-color: rgba(209, 166, 70, 0.3);
  background: var(--ld-surface);
}

#ld-export-panel .ld-status-card[data-tone="error"] {
  border-color: rgba(210, 93, 120, 0.3);
  background: var(--ld-surface);
}

#ld-export-panel .ld-status-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

#ld-export-panel .ld-progress-text {
  margin-top: 2px;
  color: var(--ld-text);
  font-size: 12px;
  line-height: 1.25;
}

#ld-export-panel .ld-progress-pill {
  padding: 3px 8px;
  border-radius: var(--ld-pill-radius);
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-deep);
  color: var(--ld-text-muted);
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

#ld-export-panel .ld-progress-rail {
  margin-top: 7px;
  height: 6px;
  border-radius: var(--ld-pill-radius);
  background: var(--ld-border-subtle);
  overflow: hidden;
}

#ld-export-panel .ld-progress-fill {
  width: 0%;
  height: 100%;
  border-radius: inherit;
  background: var(--ld-accent);
  transition: width 180ms ease;
}

#ld-export-panel .ld-status-text {
  min-height: 17px;
  margin-top: 7px;
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.35;
  word-break: break-word;
  user-select: text;
}

#ld-export-panel .ld-btn {
  appearance: none;
  width: 100%;
  border: 1px solid var(--ld-border);
  border-radius: var(--ld-pill-radius);
  padding: 8px 12px;
  background: transparent;
  color: var(--ld-text);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease, opacity 150ms ease, transform 150ms ease;
  font-family: var(--ld-font-sans);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  text-align: center;
}

#ld-export-panel .ld-btn:hover:not(:disabled) {
  border-color: rgba(62, 207, 142, 0.3);
  background: var(--ld-bg-deep);
}

#ld-export-panel .ld-btn:focus-visible,
#ld-export-panel .ld-section-toggle:focus-visible,
#ld-export-panel .ld-input:focus-visible,
#ld-export-panel a:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--ld-focus-ring);
}

#ld-export-panel .ld-btn:disabled {
  cursor: default;
  opacity: 0.56;
  transform: none;
}

#ld-export-panel .ld-btn-primary {
  border-color: rgba(62, 207, 142, 0.3);
  background: var(--ld-bg-deep);
}

#ld-export-panel .ld-btn-ghost {
  background: var(--ld-bg-deep);
  color: var(--ld-text-secondary);
}

#ld-export-panel .ld-btn-link {
  display: flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
}

#ld-export-panel .ld-action-group {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

#ld-export-panel .ld-action-group .ld-btn {
  min-width: 0;
}

#ld-export-panel .ld-export-hint {
  padding: 0 2px;
}

#ld-export-panel .ld-btn-inline {
  width: auto;
  min-width: 56px;
  padding: 7px 10px;
  border-radius: var(--ld-radius);
  white-space: nowrap;
}

#ld-export-panel .ld-fallback-wrap {
  margin-top: 0;
}

#ld-export-panel .ld-section-card {
  display: grid;
  gap: 6px;
  padding: 6px;
  border: 1px solid var(--ld-border-subtle);
  border-radius: var(--ld-radius);
  background: rgba(255, 255, 255, 0.015);
}

#ld-export-panel .ld-section-static,
#ld-export-panel .ld-section-toggle {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--ld-pill-radius);
  background: transparent;
  color: var(--ld-text);
  text-align: left;
}

#ld-export-panel .ld-section-toggle {
  cursor: pointer;
}

#ld-export-panel .ld-section-copy {
  display: grid;
  gap: 1px;
  min-width: 0;
}

#ld-export-panel .ld-section-title {
  font-size: 12px;
  font-weight: 500;
  line-height: 1.25;
}

#ld-export-panel .ld-section-meta {
  color: var(--ld-text-muted);
  font-size: 12px;
  line-height: 1.25;
}

#ld-export-panel .ld-section-panel {
  display: grid;
  gap: 6px;
  padding: 0;
}

#ld-export-panel .ld-group {
  display: grid;
  gap: 7px;
  padding: 7px;
  border-radius: var(--ld-radius);
  border: 1px solid var(--ld-border-subtle);
  background: var(--ld-bg-deep);
}

#ld-export-panel .ld-group-title {
  color: var(--ld-text-muted);
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

#ld-export-panel .ld-field {
  display: grid;
  gap: 4px;
}

#ld-export-panel .ld-field-label {
  color: var(--ld-text-muted);
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.3;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

#ld-export-panel .ld-inline-row {
  display: grid;
  gap: 6px;
}

#ld-export-panel .ld-inline-row--range {
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.8fr) minmax(0, 0.8fr);
}

#ld-export-panel .ld-control-row {
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: stretch;
}

#ld-export-panel .ld-control-row > .ld-select,
#ld-export-panel .ld-control-row > .ld-btn-inline {
  height: 38px;
}

#ld-export-panel .ld-control-row > .ld-btn-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
}

#ld-export-panel .ld-check-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

#ld-export-panel .ld-check-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-radius: var(--ld-pill-radius);
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-deep);
  color: var(--ld-text-secondary);
  cursor: pointer;
}

#ld-export-panel .ld-check-pill:has(input:checked) {
  border-color: rgba(62, 207, 142, 0.3);
  background: var(--ld-bg-deep);
  color: var(--ld-text);
}

#ld-export-panel .ld-input {
  appearance: none;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--ld-border);
  border-radius: var(--ld-radius);
  background: var(--ld-bg-deep);
  color: var(--ld-text);
  padding: 7px 10px;
  font-family: var(--ld-font-sans);
  font-size: 12px;
  line-height: 1.25;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 180ms ease, opacity 150ms ease;
  user-select: text;
}

#ld-export-panel .ld-input::placeholder {
  color: var(--ld-text-muted);
}

#ld-export-panel .ld-input:focus {
  border-color: rgba(62, 207, 142, 0.3);
  background: var(--ld-bg-deep);
}

#ld-export-panel .ld-input:disabled {
  opacity: 0.55;
  cursor: default;
}

#ld-export-panel .ld-select {
  padding-right: 34px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5 6 7.5 9 4.5' stroke='%23b4b4b4' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-position: calc(100% - 12px) 50%;
  background-size: 12px 12px;
  background-repeat: no-repeat;
}

#ld-export-panel input[type="checkbox"] {
  margin: 0;
  width: 14px;
  height: 14px;
  accent-color: var(--ld-accent);
  flex: 0 0 auto;
}

#ld-export-panel .ld-note {
  color: var(--ld-text-secondary);
  font-size: 12px;
  line-height: 1.35;
  user-select: text;
}

#ld-export-panel .ld-note[data-tone="working"] {
  color: var(--ld-text-secondary);
}

#ld-export-panel .ld-note[data-tone="warning"] {
  color: var(--ld-warning);
}

#ld-export-panel .ld-note[data-tone="error"] {
  color: var(--ld-error);
}

#ld-export-panel .ld-note[data-tone="success"] {
  color: var(--ld-text-secondary);
}

#ld-export-panel .ld-path-preview {
  color: var(--ld-text-muted);
  font-family: var(--ld-font-mono);
  word-break: break-all;
}

#ld-export-panel .ld-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 15, 15, 0.78);
}

#ld-export-panel .ld-dialog {
  width: min(420px, calc(100vw - 32px));
  max-height: min(82vh, 720px);
  overflow: auto;
  border-radius: 14px;
  border: 1px solid var(--ld-border);
  background: var(--ld-surface);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.32);
}

#ld-export-panel .ld-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 0;
}

#ld-export-panel .ld-dialog-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

#ld-export-panel .ld-dialog-title {
  color: var(--ld-text);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.25;
}

#ld-export-panel .ld-dialog-close {
  width: auto;
  min-width: 0;
  padding: 6px 10px;
  border-radius: var(--ld-radius);
}

#ld-export-panel .ld-dialog-body {
  display: grid;
  gap: 10px;
  padding: 12px 14px;
}

#ld-export-panel .ld-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 14px 14px;
}

#ld-export-panel .ld-dialog-footer .ld-btn {
  width: auto;
  min-width: 84px;
  border-radius: var(--ld-radius);
}

#ld-export-panel .ld-dialog-error {
  min-height: 17px;
  color: var(--ld-error);
  font-size: 12px;
  line-height: 1.35;
}

#ld-export-panel .ld-manage-list {
  display: grid;
  gap: 8px;
}

#ld-export-panel .ld-manage-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-radius: var(--ld-radius);
  border: 1px solid var(--ld-border-subtle);
  background: var(--ld-bg-deep);
}

#ld-export-panel .ld-manage-text {
  min-width: 0;
  color: var(--ld-text);
  word-break: break-word;
}

#ld-export-panel .ld-manage-hint {
  color: var(--ld-text-muted);
  font-family: var(--ld-font-mono);
  font-size: 12px;
  line-height: 1.35;
}

#ld-export-panel .ld-list-empty {
  padding: 12px;
  border-radius: var(--ld-radius);
  border: 1px dashed var(--ld-border);
  color: var(--ld-text-muted);
  text-align: center;
}

#ld-export-panel .ld-btn-danger {
  border-color: rgba(210, 93, 120, 0.35);
  color: #fecaca;
}

#ld-export-panel .ld-btn-danger:hover:not(:disabled) {
  border-color: rgba(210, 93, 120, 0.45);
  background: rgba(210, 93, 120, 0.08);
}

#ld-export-panel a {
  color: var(--ld-link);
  text-decoration-color: rgba(0, 197, 115, 0.35);
  text-underline-offset: 2px;
  transition: color 150ms ease, text-decoration-color 150ms ease;
}

#ld-export-panel a:hover {
  color: var(--ld-accent);
  text-decoration-color: rgba(62, 207, 142, 0.4);
}

@media (max-width: 600px) {
  #ld-export-panel {
    top: auto !important;
    left: 12px !important;
    right: 12px !important;
    bottom: 12px !important;
  }

  #ld-export-bubble-root {
    left: 12px !important;
    right: 12px !important;
  }

  #ld-export-panel .ld-shell,
  #ld-export-bubble-root .ld-bubble {
    width: 100%;
    max-width: none;
  }

  #ld-export-panel .ld-shell {
    max-height: min(86vh, 760px);
  }

  #ld-export-panel .ld-header {
    padding: 9px 10px;
  }

  #ld-export-panel .ld-body {
    padding: 8px;
  }

  #ld-export-panel .ld-inline-row--range {
    grid-template-columns: 1fr;
  }

  #ld-export-panel .ld-action-group {
    grid-template-columns: 1fr;
  }

  #ld-export-panel .ld-control-row {
    grid-template-columns: 1fr;
  }

  #ld-export-panel .ld-dialog-footer {
    flex-direction: column-reverse;
  }

  #ld-export-panel .ld-dialog-footer .ld-btn {
    width: 100%;
  }
}
`;
            document.head.appendChild(style);
        },

        getStatusTone(msg, color) {
            const text = String(msg || "");
            const normalizedColor = String(color || "").toLowerCase();

            if (/失败|无效|错误|❌/.test(text) || normalizedColor.includes("feca") || normalizedColor.includes("cf2d56")) {
                return "error";
            }
            if (/⚠|警告|无可导出|不能|请先/.test(text) || normalizedColor.includes("facc15")) {
                return "warning";
            }
            if (/正在|准备|拉取|下载|写入|生成|连接中/.test(text) || normalizedColor.includes("a855f7")) {
                return "working";
            }
            if (text) return "success";
            return "idle";
        },

        getStatusColor(tone, fallbackColor) {
            const colorMap = {
                idle: "var(--ld-text-muted)",
                working: "var(--ld-text-secondary)",
                success: "var(--ld-success)",
                warning: "var(--ld-warning)",
                error: "var(--ld-error)",
            };
            return colorMap[tone] || fallbackColor || "var(--ld-text-secondary)";
        },

        syncExportTemplateUi() {
            const template = normalizeExportTemplate(this.selExportTemplate?.value);
            const isClean = template === "clean";

            if (this.selExportTemplate) {
                this.selExportTemplate.value = template;
            }
            if (this.templateCleanHint) {
                this.templateCleanHint.style.display = isClean ? "" : "none";
            }
            if (this.exportStyleFiltersWrap) {
                this.exportStyleFiltersWrap.style.display = isClean ? "none" : "";
            }
        },

        syncAiFilterUi() {
            const enabled = !!this.chkAiFilter?.checked;
            if (this.aiSettingsWrap) {
                this.aiSettingsWrap.style.display = enabled ? "" : "none";
            }
        },

        renderSelectOptions(selectEl, items, selectedValue) {
            if (!selectEl) return;

            const selectedKey = normalizeCaseKey(selectedValue);
            selectEl.innerHTML = "";
            for (const item of Array.isArray(items) ? items : []) {
                const option = document.createElement("option");
                option.value = item;
                option.textContent = item;
                if (normalizeCaseKey(item) === selectedKey) {
                    option.selected = true;
                }
                selectEl.appendChild(option);
            }
        },

        applyControlDisabled(control, disabled) {
            if (!control) return;
            control.disabled = !!disabled;
            if (control.classList?.contains("ld-btn") || control.classList?.contains("ld-icon-btn")) {
                control.style.opacity = disabled ? "0.6" : "1";
            }
        },

        isMobileViewport() {
            return window.innerWidth <= 600;
        },

        getViewportInset() {
            return this.isMobileViewport() ? 12 : 16;
        },

        getBubbleVerticalBounds() {
            const inset = this.getViewportInset();
            const bubbleHeight = Math.max(42, this.bubbleBtn?.offsetHeight || 0);
            const minY = inset;
            const maxY = Math.max(minY, window.innerHeight - bubbleHeight - inset);
            return { inset, bubbleHeight, minY, maxY };
        },

        normalizeBubbleY(value) {
            const { minY, maxY } = this.getBubbleVerticalBounds();
            const fallback = maxY;
            const numeric = Number(value);
            return clampInt(Number.isFinite(numeric) ? Math.round(numeric) : fallback, minY, maxY, fallback);
        },

        getCurrentBubbleY() {
            if (!this.bubbleBtn) return this.getBubbleVerticalBounds().maxY;
            return Math.round(this.bubbleBtn.getBoundingClientRect().top);
        },

        applyBubbleY(value, persist) {
            if (!this.bubbleRoot || !this.bubbleBtn) return;

            const nextBubbleY = this.normalizeBubbleY(value);
            const inset = this.getViewportInset();
            this.bubbleRoot.style.top = `${nextBubbleY}px`;
            this.bubbleRoot.style.bottom = "auto";
            this.bubbleRoot.style.right = `${inset}px`;
            this.bubbleRoot.style.left = this.isMobileViewport() ? `${inset}px` : "auto";
            this.bubbleY = nextBubbleY;

            if (persist) {
                GM_setValue(K.BUBBLE_Y, nextBubbleY);
            }
        },

        syncBubblePosition(persist) {
            const targetBubbleY = this.bubbleY ?? this.normalizeBubbleY(GM_getValue(K.BUBBLE_Y, null));
            this.applyBubbleY(targetBubbleY, !!persist);
        },

        getPanelBounds() {
            const inset = this.getViewportInset();
            const width = Math.max(260, this.panelRoot?.offsetWidth || this.shell?.offsetWidth || Math.min(360, Math.max(260, window.innerWidth - inset * 2)));
            const height = Math.max(220, this.panelRoot?.offsetHeight || this.shell?.offsetHeight || Math.min(820, Math.max(220, Math.round(window.innerHeight * 0.88))));
            return {
                inset,
                width,
                height,
                minX: inset,
                maxX: Math.max(inset, window.innerWidth - width - inset),
                minY: inset,
                maxY: Math.max(inset, window.innerHeight - height - inset),
            };
        },

        getDefaultPanelPosition(bounds = this.getPanelBounds()) {
            const bubbleTop = this.bubbleY ?? this.normalizeBubbleY(GM_getValue(K.BUBBLE_Y, null));
            const gap = 10;
            const y = clampInt(bubbleTop - bounds.height - gap, bounds.minY, bounds.maxY, bounds.maxY);
            return { x: bounds.maxX, y };
        },

        applyPanelPosition() {
            if (!this.panelRoot) return;

            const inset = this.getViewportInset();
            if (this.isMobileViewport()) {
                this.panelRoot.style.top = "auto";
                this.panelRoot.style.left = `${inset}px`;
                this.panelRoot.style.right = `${inset}px`;
                this.panelRoot.style.bottom = `${inset}px`;
                return;
            }

            const nextPosition = this.getDefaultPanelPosition();
            this.panelRoot.style.top = `${nextPosition.y}px`;
            this.panelRoot.style.left = `${nextPosition.x}px`;
            this.panelRoot.style.right = "auto";
            this.panelRoot.style.bottom = "auto";
        },

        syncPanelPosition() {
            if (!this.panelRoot) return;
            this.applyPanelPosition();
        },

        bindBubbleDrag() {
            if (!this.bubbleBtn) return;

            let dragState = null;
            const dragThreshold = 4;

            const finishDrag = (event) => {
                if (!dragState || event.pointerId !== dragState.pointerId) return;

                if (dragState.moved) {
                    const clientY = typeof event.clientY === "number" ? event.clientY : dragState.lastClientY;
                    this.applyBubbleY(dragState.startBubbleY + (clientY - dragState.startClientY), true);
                    this.bubbleSuppressClickUntil = Date.now() + 250;
                } else {
                    this.syncBubblePosition(false);
                }

                if (this.bubbleBtn.hasPointerCapture?.(dragState.pointerId)) {
                    this.bubbleBtn.releasePointerCapture(dragState.pointerId);
                }
                delete this.bubbleBtn.dataset.dragging;
                dragState = null;
            };

            this.bubbleBtn.addEventListener("pointerdown", (event) => {
                if (event.pointerType === "mouse" && event.button !== 0) return;

                dragState = {
                    pointerId: event.pointerId,
                    startClientY: event.clientY,
                    lastClientY: event.clientY,
                    startBubbleY: this.getCurrentBubbleY(),
                    moved: false,
                };
                this.bubbleBtn.dataset.dragging = "true";
                this.bubbleBtn.setPointerCapture?.(event.pointerId);
            });

            this.bubbleBtn.addEventListener("pointermove", (event) => {
                if (!dragState || event.pointerId !== dragState.pointerId) return;

                dragState.lastClientY = event.clientY;
                const deltaY = event.clientY - dragState.startClientY;
                if (!dragState.moved && Math.abs(deltaY) >= dragThreshold) {
                    dragState.moved = true;
                }
                if (!dragState.moved) return;

                this.applyBubbleY(dragState.startBubbleY + deltaY, false);
                event.preventDefault();
            });

            this.bubbleBtn.addEventListener("pointerup", finishDrag);
            this.bubbleBtn.addEventListener("pointercancel", finishDrag);
        },

        isPanelOpen() {
            return !!this.panelRoot && !this.panelRoot.hidden;
        },

        setPanelOpen(open) {
            if (!this.panelRoot || !this.bubbleRoot) return;

            const nextOpen = !!open;
            this.panelRoot.hidden = !nextOpen;
            this.panelRoot.setAttribute("aria-hidden", String(!nextOpen));
            this.bubbleRoot.hidden = nextOpen;
            this.bubbleRoot.setAttribute("aria-hidden", String(nextOpen));

            if (this.bubbleBtn) {
                this.bubbleBtn.setAttribute("aria-expanded", String(nextOpen));
                this.bubbleBtn.title = nextOpen ? "面板已展开" : "展开面板";
            }

            GM_setValue(K.PANEL_COLLAPSED, !nextOpen);
            requestAnimationFrame(() => {
                if (nextOpen) {
                    this.syncPanelPosition();
                } else {
                    this.syncBubblePosition(false);
                }
            });
        },

        syncActionAvailability() {
            const disabled = !!this.isBusy;
            this.applyControlDisabled(this.btnMarkdown, disabled);
            this.applyControlDisabled(this.btnObsidian, disabled);
            this.applyControlDisabled(this.btnTestConnection, disabled);
        },

        setObsidianOverview(message, tone) {
            if (!this.obsOverviewNote) return;
            this.obsOverviewNote.textContent = message || "";
            this.obsOverviewNote.dataset.tone = tone || "success";
        },

        persistObsidianLocationConfig(patch) {
            const current = this.obsidianConfig || getStoredObsidianConfig();
            this.obsidianConfig = persistObsidianStorageConfig({
                ...current,
                ...patch,
            });
            this.syncObsidianLocationUi();
            return this.obsidianConfig;
        },

        syncObsidianLocationUi() {
            this.obsidianConfig = buildNormalizedObsidianStorageConfig(this.obsidianConfig || getStoredObsidianConfig());
            const resolved = resolveObsidianPaths(this.obsidianConfig);

            this.renderSelectOptions(this.selObsRoot, this.obsidianConfig.roots, resolved.root);
            this.renderSelectOptions(this.selObsCategory, this.obsidianConfig.categories, resolved.category);

            if (this.inputObsImgDir) {
                this.inputObsImgDir.value = this.obsidianConfig.imgDirRaw || "";
            }
            if (this.obsImgPreviewNote) {
                this.obsImgPreviewNote.textContent = this.obsidianConfig.imgDirKind === OBS_IMG_DIR_KIND.LEGACY
                    ? `当前使用 legacy 图片路径：${resolved.imgDir || "(未配置)"}`
                    : `最终路径：${resolved.imgDir || "(未配置)"}`;
            }
        },

        scheduleObsidianOverviewRefresh() {
            if (this.obsOverviewTimer) {
                clearTimeout(this.obsOverviewTimer);
            }
            this.obsOverviewTimer = setTimeout(() => {
                this.refreshObsidianOverview().catch((error) => {
                    console.warn("刷新 Obsidian 目录概览失败:", error);
                });
            }, 120);
        },

        async refreshObsidianOverview() {
            if (!this.panelRoot) return;

            const seq = ++this.obsOverviewRefreshSeq;
            const settings = this.getSettings();
            const { root, dir } = settings.obsidian;

            if (!settings.obsidian.apiKey) {
                this.setObsidianOverview("未配置 Obsidian 连接，暂无法获取目录概览", "warning");
                return;
            }

            this.setObsidianOverview("正在读取根目录与分类概览…", "working");

            try {
                const rootTree = await listMarkdownFilesRecursive(root, settings);
                if (seq !== this.obsOverviewRefreshSeq) return;
                const categoryTree = await listMarkdownFilesRecursive(dir, settings);
                if (seq !== this.obsOverviewRefreshSeq) return;

                const rootCount = rootTree.notFound ? 0 : rootTree.paths.length;
                const categoryCount = categoryTree.notFound ? 0 : categoryTree.paths.length;

                let message = `根目录下已收藏 ${rootCount} 篇主题，当前分类下已收藏 ${categoryCount} 篇主题`;
                let tone = "success";

                if (rootTree.notFound) {
                    message += "。根目录尚不存在，首次导出时创建/写入。";
                    tone = "warning";
                } else if (categoryTree.notFound) {
                    message += "。分类目录尚不存在，首次导出时创建/写入。";
                    tone = "warning";
                }

                this.setObsidianOverview(message, tone);
            } catch (error) {
                if (seq !== this.obsOverviewRefreshSeq) return;

                const status = Number(error?.status || 0);
                if (status === 401 || status === 403) {
                    this.setObsidianOverview("API Key 无效，目录概览不可用", "error");
                } else if (error?.name === "ObsidianNetworkError") {
                    this.setObsidianOverview("无法连接 Obsidian API，目录概览不可用", "warning");
                } else {
                    this.setObsidianOverview("目录概览读取失败，请稍后重试", "error");
                }
            }
        },

        createDialogFrame(options) {
            const backdrop = document.createElement("div");
            backdrop.className = "ld-dialog-backdrop";
            backdrop.innerHTML = `
<div class="ld-dialog" role="dialog" aria-modal="true">
  <div class="ld-dialog-header">
    <div class="ld-dialog-copy">
      <div class="ld-kicker">Export Dialog</div>
      <div class="ld-dialog-title"></div>
    </div>
    <button class="ld-btn ld-btn-ghost ld-dialog-close" type="button">关闭</button>
  </div>
  <div class="ld-dialog-body"></div>
  <div class="ld-dialog-footer"></div>
</div>`;

            const dialog = backdrop.querySelector(".ld-dialog");
            const titleEl = backdrop.querySelector(".ld-dialog-title");
            const bodyEl = backdrop.querySelector(".ld-dialog-body");
            const footerEl = backdrop.querySelector(".ld-dialog-footer");
            const closeBtn = backdrop.querySelector(".ld-dialog-close");
            titleEl.textContent = options?.title || "提示";

            let closed = false;
            const teardown = () => {
                backdrop.remove();
                document.removeEventListener("keydown", onKeyDown, true);
            };
            const close = (value) => {
                if (closed) return value;
                closed = true;
                teardown();
                return value;
            };
            const onKeyDown = (event) => {
                if (event.key === "Escape") {
                    close(options?.onCancel ? options.onCancel() : null);
                }
            };

            closeBtn.addEventListener("click", () => {
                close(options?.onCancel ? options.onCancel() : null);
            });
            backdrop.addEventListener("click", (event) => {
                if (event.target === backdrop) {
                    close(options?.onCancel ? options.onCancel() : null);
                }
            });

            document.addEventListener("keydown", onKeyDown, true);
            this.panelRoot.appendChild(backdrop);

            return {
                backdrop,
                dialog,
                bodyEl,
                footerEl,
                close,
            };
        },

        showConfirmDialog(options) {
            return new Promise((resolve) => {
                const frame = this.createDialogFrame({
                    title: options?.title || "二次确认",
                    onCancel: () => resolve(false),
                });

                if (options?.message) {
                    const messageEl = document.createElement("div");
                    messageEl.className = "ld-note";
                    messageEl.textContent = options.message;
                    frame.bodyEl.appendChild(messageEl);
                }

                if (Array.isArray(options?.details) && options.details.length > 0) {
                    const listEl = document.createElement("div");
                    listEl.className = "ld-manage-list";
                    for (const item of options.details) {
                        const row = document.createElement("div");
                        row.className = "ld-manage-item";

                        const text = document.createElement("div");
                        text.className = "ld-manage-text";
                        text.textContent = item;
                        row.appendChild(text);
                        listEl.appendChild(row);
                    }
                    frame.bodyEl.appendChild(listEl);
                }

                const cancelBtn = document.createElement("button");
                cancelBtn.className = "ld-btn ld-btn-ghost";
                cancelBtn.type = "button";
                cancelBtn.textContent = options?.cancelText || "取消";
                cancelBtn.addEventListener("click", () => {
                    frame.close(resolve(false));
                });

                const confirmBtn = document.createElement("button");
                confirmBtn.className = `ld-btn ${options?.danger ? "ld-btn-danger" : "ld-btn-primary"}`;
                confirmBtn.type = "button";
                confirmBtn.textContent = options?.confirmText || "继续";
                confirmBtn.addEventListener("click", () => {
                    frame.close(resolve(true));
                });

                frame.footerEl.appendChild(cancelBtn);
                frame.footerEl.appendChild(confirmBtn);
                confirmBtn.focus();
            });
        },

        showInputDialog(options) {
            return new Promise((resolve) => {
                const frame = this.createDialogFrame({
                    title: options?.title || "新增",
                    onCancel: () => resolve(null),
                });

                const field = document.createElement("label");
                field.className = "ld-field";

                const label = document.createElement("span");
                label.className = "ld-field-label";
                label.textContent = options?.label || "名称";
                field.appendChild(label);

                const input = document.createElement("input");
                input.className = "ld-input";
                input.type = "text";
                input.placeholder = options?.placeholder || "";
                input.value = options?.value || "";
                field.appendChild(input);
                frame.bodyEl.appendChild(field);

                if (options?.note) {
                    const note = document.createElement("div");
                    note.className = "ld-note";
                    note.textContent = options.note;
                    frame.bodyEl.appendChild(note);
                }

                const errorEl = document.createElement("div");
                errorEl.className = "ld-dialog-error";
                frame.bodyEl.appendChild(errorEl);

                const cancelBtn = document.createElement("button");
                cancelBtn.className = "ld-btn ld-btn-ghost";
                cancelBtn.type = "button";
                cancelBtn.textContent = options?.cancelText || "取消";
                cancelBtn.addEventListener("click", () => {
                    frame.close(resolve(null));
                });

                const confirmBtn = document.createElement("button");
                confirmBtn.className = "ld-btn ld-btn-primary";
                confirmBtn.type = "button";
                confirmBtn.textContent = options?.confirmText || "保存";

                const submit = () => {
                    errorEl.textContent = "";
                    const rawValue = input.value || "";
                    const result = typeof options?.validate === "function"
                        ? options.validate(rawValue)
                        : { value: rawValue.trim() };

                    if (typeof result === "string") {
                        errorEl.textContent = result;
                        return;
                    }

                    const nextValue = typeof result === "object" && result && "value" in result
                        ? result.value
                        : String(rawValue || "").trim();
                    if (!nextValue) {
                        errorEl.textContent = "请输入有效内容";
                        return;
                    }

                    frame.close(resolve(nextValue));
                };

                confirmBtn.addEventListener("click", submit);
                input.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                    }
                });

                frame.footerEl.appendChild(cancelBtn);
                frame.footerEl.appendChild(confirmBtn);
                input.focus();
                input.select();
            });
        },

        showManageListDialog(options) {
            return new Promise((resolve) => {
                const frame = this.createDialogFrame({
                    title: options?.title || "管理列表",
                    onCancel: () => resolve(false),
                });

                const errorEl = document.createElement("div");
                errorEl.className = "ld-dialog-error";

                const listEl = document.createElement("div");
                listEl.className = "ld-manage-list";

                const render = () => {
                    errorEl.textContent = "";
                    listEl.innerHTML = "";

                    const items = typeof options?.getItems === "function" ? options.getItems() : [];
                    if (!Array.isArray(items) || items.length === 0) {
                        const empty = document.createElement("div");
                        empty.className = "ld-list-empty";
                        empty.textContent = options?.emptyText || "暂无可管理项目";
                        listEl.appendChild(empty);
                        return;
                    }

                    for (const item of items) {
                        const row = document.createElement("div");
                        row.className = "ld-manage-item";

                        const textWrap = document.createElement("div");
                        textWrap.className = "ld-manage-text";

                        const title = document.createElement("div");
                        title.textContent = item;
                        textWrap.appendChild(title);

                        if (options?.itemHint) {
                            const hint = document.createElement("div");
                            hint.className = "ld-manage-hint";
                            hint.textContent = options.itemHint(item);
                            textWrap.appendChild(hint);
                        }

                        const deleteBtn = document.createElement("button");
                        deleteBtn.className = "ld-btn ld-btn-danger ld-btn-inline";
                        deleteBtn.type = "button";
                        deleteBtn.textContent = "删除";
                        deleteBtn.addEventListener("click", async () => {
                            errorEl.textContent = "";
                            try {
                                await options.onDelete(item);
                                render();
                            } catch (error) {
                                errorEl.textContent = error?.message || String(error || "");
                            }
                        });

                        row.appendChild(textWrap);
                        row.appendChild(deleteBtn);
                        listEl.appendChild(row);
                    }
                };

                frame.bodyEl.appendChild(listEl);
                frame.bodyEl.appendChild(errorEl);

                const closeBtn = document.createElement("button");
                closeBtn.className = "ld-btn ld-btn-primary";
                closeBtn.type = "button";
                closeBtn.textContent = "完成";
                closeBtn.addEventListener("click", () => {
                    frame.close(resolve(true));
                });
                frame.footerEl.appendChild(closeBtn);

                render();
                closeBtn.focus();
            });
        },

        async handleAddObsRoot() {
            const value = await this.showInputDialog({
                title: "新增根目录",
                label: "根目录",
                placeholder: "如 Linux.do、Forum/Linux 或 IDCFlare",
                note: "根目录用于区分不同社区或主存储位置，可包含多级相对路径。",
                confirmText: "新增",
                validate: (rawValue) => {
                    const normalized = normalizeRootName(rawValue);
                    if (!normalized) {
                        return "根目录必须是 vault 内的相对路径，且不能包含 . 或 ..";
                    }
                    if ((this.obsidianConfig?.roots || []).some((item) => normalizeCaseKey(item) === normalizeCaseKey(normalized))) {
                        return "根目录已存在";
                    }
                    return { value: normalized };
                },
            });

            if (!value) return;
            this.persistObsidianLocationConfig({
                roots: [...(this.obsidianConfig?.roots || []), value],
                currentRoot: value,
            });
            this.scheduleObsidianOverviewRefresh();
        },

        async handleAddObsCategory() {
            const value = await this.showInputDialog({
                title: "新增分类",
                label: "分类",
                placeholder: "如 内核、前端、效率工具",
                note: "分类固定为单层目录名，不允许包含 / 或 \\。",
                confirmText: "新增",
                validate: (rawValue) => {
                    const normalized = normalizeCategoryName(rawValue);
                    if (!normalized) {
                        return "分类必须是单层目录名，且不能包含 / 或 \\";
                    }
                    if ((this.obsidianConfig?.categories || []).some((item) => normalizeCaseKey(item) === normalizeCaseKey(normalized))) {
                        return "分类已存在";
                    }
                    return { value: normalized };
                },
            });

            if (!value) return;
            this.persistObsidianLocationConfig({
                categories: [...(this.obsidianConfig?.categories || []), value],
                currentCategory: value,
            });
            this.scheduleObsidianOverviewRefresh();
        },

        async handleManageObsRoots() {
            await this.showManageListDialog({
                title: "管理根目录",
                getItems: () => this.obsidianConfig?.roots || [],
                emptyText: "暂无根目录",
                onDelete: async (targetRoot) => {
                    const roots = this.obsidianConfig?.roots || [];
                    if (roots.length <= 1) {
                        throw new Error("至少保留 1 个根目录");
                    }

                    const nextRoots = roots.filter((item) => normalizeCaseKey(item) !== normalizeCaseKey(targetRoot));
                    this.persistObsidianLocationConfig({
                        roots: nextRoots,
                        currentRoot: this.obsidianConfig?.currentRoot,
                    });
                    this.scheduleObsidianOverviewRefresh();
                },
            });
        },

        async handleManageObsCategories() {
            await this.showManageListDialog({
                title: "管理分类",
                getItems: () => this.obsidianConfig?.categories || [],
                emptyText: "暂无分类",
                onDelete: async (targetCategory) => {
                    const categories = this.obsidianConfig?.categories || [];
                    if (categories.length <= 1) {
                        throw new Error("至少保留 1 个分类");
                    }

                    const nextCategories = categories.filter((item) => normalizeCaseKey(item) !== normalizeCaseKey(targetCategory));
                    this.persistObsidianLocationConfig({
                        categories: nextCategories,
                        currentCategory: this.obsidianConfig?.currentCategory,
                    });
                    this.scheduleObsidianOverviewRefresh();
                },
            });
        },

        init() {
            if (this.panelRoot && this.bubbleRoot) return;
            this.ensureStyles();

            const panelRoot = document.createElement("div");
            panelRoot.id = "ld-export-panel";
            panelRoot.hidden = true;
            panelRoot.innerHTML = `
<div class="ld-shell">
  <div class="ld-header">
    <div class="ld-brand">
      <div class="ld-kicker">Discourse2MD</div>
      <div class="ld-title">导出内容</div>
    </div>
    <div class="ld-header-side">
      <button id="ld-panel-collapse" class="ld-icon-btn" type="button" aria-label="收起面板">
        <svg class="ld-icon-close" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 4L12 12M12 4L4 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        </svg>
      </button>
    </div>
  </div>

  <div class="ld-body">
    <div id="ld-status-card" class="ld-status-card" data-tone="idle">
      <div class="ld-status-top">
        <div>
          <div id="ld-progress-text" class="ld-progress-text">准备就绪</div>
        </div>
      </div>
      <div class="ld-progress-rail">
        <div id="ld-progress-fill" class="ld-progress-fill"></div>
      </div>
      <div id="ld-status" class="ld-status-text"></div>
    </div>

    <div class="ld-action-group">
      <button id="ld-export-markdown" class="ld-btn ld-btn-primary" type="button">导出 Markdown</button>
      <button id="ld-export-obsidian" class="ld-btn ld-btn-ghost" type="button">导出到 Obsidian</button>
    </div>

    <div class="ld-note ld-export-hint">Markdown 下载默认内嵌 Base64 图片；下方图片设置仅作用于 Obsidian 导出。</div>

    <div id="ld-fallback-wrap" class="ld-fallback-wrap" style="display:none;">
      <a id="ld-fallback-btn" class="ld-btn ld-btn-ghost ld-btn-link" download>兜底下载（点击保存）</a>
    </div>

    <div class="ld-section-card">
      <button id="ld-obsidian-toggle" class="ld-section-toggle" type="button">
        <span class="ld-section-copy">
          <span class="ld-section-title">Obsidian 连接设置</span>
          <span class="ld-section-meta">API、导出位置与图片导出</span>
        </span>
        <span id="ld-obsidian-arrow" class="ld-section-arrow">▾</span>
      </button>

      <div id="ld-obsidian-wrap" class="ld-section-panel" style="display:none;">
        <div class="ld-group">
          <div class="ld-group-title">连接信息</div>

          <label class="ld-field">
            <span class="ld-field-label">API 地址</span>
            <input id="ld-obs-api-url" class="ld-input" type="text" placeholder="默认 https://127.0.0.1:27124" />
          </label>

          <label class="ld-field">
            <span class="ld-field-label">API Key</span>
            <input id="ld-obs-api-key" class="ld-input" type="password" placeholder="在 Obsidian 插件设置中获取" />
          </label>

          <button id="ld-test-connection" class="ld-btn ld-btn-ghost" type="button">测试连接</button>
        </div>

        <div class="ld-group">
          <div class="ld-group-title">导出位置</div>

          <label class="ld-field">
            <span class="ld-field-label">根目录</span>
            <div class="ld-control-row">
              <select id="ld-obs-root" class="ld-input ld-select"></select>
              <button id="ld-obs-root-add" class="ld-btn ld-btn-ghost ld-btn-inline" type="button">新增</button>
              <button id="ld-obs-root-manage" class="ld-btn ld-btn-ghost ld-btn-inline" type="button">管理</button>
            </div>
          </label>

          <label class="ld-field">
            <span class="ld-field-label">分类</span>
            <div class="ld-control-row">
              <select id="ld-obs-category" class="ld-input ld-select"></select>
              <button id="ld-obs-category-add" class="ld-btn ld-btn-ghost ld-btn-inline" type="button">新增</button>
              <button id="ld-obs-category-manage" class="ld-btn ld-btn-ghost ld-btn-inline" type="button">管理</button>
            </div>
          </label>

          <div id="ld-obs-overview" class="ld-note" data-tone="working">正在准备目录概览…</div>
        </div>

        <div class="ld-group">
          <div class="ld-group-title">图片导出</div>

          <label class="ld-field">
            <span class="ld-field-label">图片模式</span>
            <select id="ld-obs-img-mode" class="ld-input ld-select">
              <option value="file">保存图片并引用（体积小）</option>
              <option value="base64">内嵌到笔记（单文件）</option>
              <option value="none">不导出图片（纯文字）</option>
            </select>
          </label>

          <label id="ld-obs-img-dir-wrap" class="ld-field" style="display:none;">
            <span class="ld-field-label">图片目录</span>
            <input id="ld-obs-img-dir" class="ld-input" type="text" placeholder="如 images 或 attachments/topic-assets" />
          </label>

          <div id="ld-obs-img-preview" class="ld-note ld-path-preview">最终路径：</div>
        </div>

        <div class="ld-note">
          提示：需安装 <a href="https://github.com/coddingtonbear/obsidian-local-rest-api" target="_blank" rel="noreferrer">Local REST API</a> 插件。未信任本地证书时，脚本会自动尝试回退到本机 HTTP。
        </div>
      </div>
    </div>

    <div class="ld-section-card" id="ld-template-section">
      <button id="ld-template-toggle" class="ld-section-toggle" type="button">
        <span class="ld-section-copy">
          <span class="ld-section-title">导出风格</span>
          <span class="ld-section-meta">选择导出模板，并按需筛选回复楼层</span>
        </span>
        <span id="ld-template-arrow" class="ld-section-arrow">▴</span>
      </button>

      <div id="ld-template-wrap" class="ld-section-panel">
        <div class="ld-group">
          <label class="ld-field">
            <span class="ld-field-label">导出模板</span>
            <select id="ld-export-template" class="ld-input ld-select">
              <option value="forum">论坛风格</option>
              <option value="clean">纯净风格</option>
            </select>
          </label>

          <div id="ld-export-template-hint" class="ld-note" style="display:none;">
            纯净风格仅导出笔记属性、帖子信息和首帖正文；回复楼层不会导出。
          </div>
        </div>

        <div id="ld-export-style-filters" class="ld-section-panel">
          <div class="ld-group">
            <div class="ld-group-title">范围与对象</div>

            <label class="ld-field">
              <span class="ld-field-label">楼层范围</span>
              <div class="ld-inline-row ld-inline-row--range">
                <select id="ld-range-mode" class="ld-input ld-select">
                  <option value="all">全部楼层</option>
                  <option value="range">指定范围</option>
                </select>
                <input id="ld-range-start" class="ld-input" type="number" placeholder="起始" />
                <input id="ld-range-end" class="ld-input" type="number" placeholder="结束" />
              </div>
            </label>

            <div class="ld-check-row">
              <label class="ld-check-pill">
                <input id="ld-only-op" type="checkbox" />
                <span>只看楼主</span>
              </label>
            </div>

            <label class="ld-field">
              <span class="ld-field-label">图片筛选</span>
              <select id="ld-img-filter" class="ld-input ld-select">
                <option value="none">无（不筛选）</option>
                <option value="withImg">仅含图楼层</option>
                <option value="noImg">仅无图楼层</option>
              </select>
            </label>

            <label class="ld-field">
              <span class="ld-field-label">指定用户</span>
              <input id="ld-users" class="ld-input" type="text" placeholder="多个用户名用逗号分隔" />
            </label>
          </div>

          <div class="ld-group">
            <div class="ld-group-title">文本条件</div>

            <label class="ld-field">
              <span class="ld-field-label">包含关键词</span>
              <input id="ld-include" class="ld-input" type="text" placeholder="命中任一关键词即可保留" />
            </label>

            <label class="ld-field">
              <span class="ld-field-label">排除关键词</span>
              <input id="ld-exclude" class="ld-input" type="text" placeholder="命中任一关键词即过滤" />
            </label>

            <label class="ld-field">
              <span class="ld-field-label">最少字数</span>
              <input id="ld-minlen" class="ld-input" type="number" placeholder="0" />
            </label>
          </div>

          <div class="ld-group">
            <div class="ld-group-title">AI 过滤</div>

            <div class="ld-check-row">
              <label class="ld-check-pill">
                <input id="ld-ai-filter-enabled" type="checkbox" />
                <span>启用 AI 过滤</span>
              </label>
            </div>

            <div id="ld-ai-filter-settings" style="display:none;">
              <label class="ld-field">
                <span class="ld-field-label">API URL</span>
                <input id="ld-ai-api-url" class="ld-input" type="text" placeholder="如 https://api.openai.com/v1" />
              </label>

              <label class="ld-field">
                <span class="ld-field-label">API Key</span>
                <input id="ld-ai-api-key" class="ld-input" type="password" placeholder="输入 openai-compatible API Key" />
              </label>

              <label class="ld-field">
                <span class="ld-field-label">Model ID</span>
                <input id="ld-ai-model-id" class="ld-input" type="text" placeholder="如 gpt-4o-mini" />
              </label>
            </div>

            <div class="ld-note">
              首帖固定保留，不参与 AI 筛选；AI 仅分析规则筛选后的非首帖楼层，并只返回需排除的 index。
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;

            const bubbleRoot = document.createElement("div");
            bubbleRoot.id = "ld-export-bubble-root";
            bubbleRoot.hidden = true;
            bubbleRoot.innerHTML = `
<button id="ld-export-bubble" class="ld-bubble" type="button" aria-expanded="false" data-tone="success">
  <span class="ld-bubble-dot"></span>
  <span id="ld-bubble-label" class="ld-bubble-label">导出</span>
</button>`;

            document.body.appendChild(panelRoot);
            document.body.appendChild(bubbleRoot);

            this.panelRoot = panelRoot;
            this.bubbleRoot = bubbleRoot;
            this.shell = panelRoot.querySelector(".ld-shell");
            this.bubbleBtn = bubbleRoot.querySelector("#ld-export-bubble");
            this.bubbleLabel = bubbleRoot.querySelector("#ld-bubble-label");
            this.btnCollapsePanel = panelRoot.querySelector("#ld-panel-collapse");
            this.btnObsidianToggle = panelRoot.querySelector("#ld-obsidian-toggle");
            this.obsidianArrow = panelRoot.querySelector("#ld-obsidian-arrow");
            this.btnTemplateToggle = panelRoot.querySelector("#ld-template-toggle");
            this.templateArrow = panelRoot.querySelector("#ld-template-arrow");

            this.statusCard = panelRoot.querySelector("#ld-status-card");
            this.progressBar = panelRoot.querySelector("#ld-progress-fill");
            this.progressText = panelRoot.querySelector("#ld-progress-text");
            this.statusText = panelRoot.querySelector("#ld-status");
            this.btnMarkdown = panelRoot.querySelector("#ld-export-markdown");
            this.btnObsidian = panelRoot.querySelector("#ld-export-obsidian");
            this.btnTestConnection = panelRoot.querySelector("#ld-test-connection");
            this.selExportTemplate = panelRoot.querySelector("#ld-export-template");
            this.templateCleanHint = panelRoot.querySelector("#ld-export-template-hint");
            this.exportStyleWrap = panelRoot.querySelector("#ld-template-wrap");
            this.exportStyleFiltersWrap = panelRoot.querySelector("#ld-export-style-filters");

            this.selRangeMode = panelRoot.querySelector("#ld-range-mode");
            this.inputRangeStart = panelRoot.querySelector("#ld-range-start");
            this.inputRangeEnd = panelRoot.querySelector("#ld-range-end");

            this.chkOnlyOp = panelRoot.querySelector("#ld-only-op");
            this.selImgFilter = panelRoot.querySelector("#ld-img-filter");
            this.inputUsers = panelRoot.querySelector("#ld-users");
            this.inputInclude = panelRoot.querySelector("#ld-include");
            this.inputExclude = panelRoot.querySelector("#ld-exclude");
            this.inputMinLen = panelRoot.querySelector("#ld-minlen");
            this.chkAiFilter = panelRoot.querySelector("#ld-ai-filter-enabled");
            this.aiSettingsWrap = panelRoot.querySelector("#ld-ai-filter-settings");
            this.inputAiApiUrl = panelRoot.querySelector("#ld-ai-api-url");
            this.inputAiApiKey = panelRoot.querySelector("#ld-ai-api-key");
            this.inputAiModelId = panelRoot.querySelector("#ld-ai-model-id");

            this.obsidianWrap = panelRoot.querySelector("#ld-obsidian-wrap");

            this.inputObsApiUrl = panelRoot.querySelector("#ld-obs-api-url");
            this.inputObsApiKey = panelRoot.querySelector("#ld-obs-api-key");
            this.selObsRoot = panelRoot.querySelector("#ld-obs-root");
            this.btnAddObsRoot = panelRoot.querySelector("#ld-obs-root-add");
            this.btnManageObsRoots = panelRoot.querySelector("#ld-obs-root-manage");
            this.selObsCategory = panelRoot.querySelector("#ld-obs-category");
            this.btnAddObsCategory = panelRoot.querySelector("#ld-obs-category-add");
            this.btnManageObsCategories = panelRoot.querySelector("#ld-obs-category-manage");
            this.obsOverviewNote = panelRoot.querySelector("#ld-obs-overview");
            this.selObsImgMode = panelRoot.querySelector("#ld-obs-img-mode");
            this.obsImgDirWrap = panelRoot.querySelector("#ld-obs-img-dir-wrap");
            this.inputObsImgDir = panelRoot.querySelector("#ld-obs-img-dir");
            this.obsImgPreviewNote = panelRoot.querySelector("#ld-obs-img-preview");

            this.btnFallback = panelRoot.querySelector("#ld-fallback-btn");

            const exportTemplate = normalizeExportTemplate(GM_getValue(K.EXPORT_TEMPLATE, DEFAULTS.exportTemplate));
            const rangeMode = GM_getValue(K.RANGE_MODE, DEFAULTS.rangeMode);
            const rangeStart = GM_getValue(K.RANGE_START, DEFAULTS.rangeStart);
            const rangeEnd = GM_getValue(K.RANGE_END, DEFAULTS.rangeEnd);
            const onlyOp = GM_getValue(K.FILTER_ONLY_OP, DEFAULTS.onlyOp);
            const imgFilter = GM_getValue(K.FILTER_IMG, DEFAULTS.imgFilter);
            const users = GM_getValue(K.FILTER_USERS, DEFAULTS.users);
            const include = GM_getValue(K.FILTER_INCLUDE, DEFAULTS.include);
            const exclude = GM_getValue(K.FILTER_EXCLUDE, DEFAULTS.exclude);
            const minLen = GM_getValue(K.FILTER_MINLEN, DEFAULTS.minLen);
            const aiEnabled = GM_getValue(K.AI_FILTER_ENABLED, DEFAULTS.aiEnabled);
            const aiApiUrl = GM_getValue(K.AI_API_URL, DEFAULTS.aiApiUrl);
            const aiApiKey = GM_getValue(K.AI_API_KEY, DEFAULTS.aiApiKey);
            const aiModelId = GM_getValue(K.AI_MODEL_ID, DEFAULTS.aiModelId);
            const obsImgMode = GM_getValue(K.OBS_IMG_MODE, DEFAULTS.obsImgMode);
            const obsApiUrl = GM_getValue(K.OBS_API_URL, DEFAULTS.obsApiUrl);
            const obsApiKey = GM_getValue(K.OBS_API_KEY, DEFAULTS.obsApiKey);
            this.obsidianConfig = getStoredObsidianConfig();

            this.selExportTemplate.value = exportTemplate;
            this.selRangeMode.value = rangeMode;
            this.inputRangeStart.value = String(rangeStart);
            this.inputRangeEnd.value = String(rangeEnd);
            this.chkOnlyOp.checked = !!onlyOp;
            this.selImgFilter.value = imgFilter || DEFAULTS.imgFilter;
            this.inputUsers.value = users || "";
            this.inputInclude.value = include || "";
            this.inputExclude.value = exclude || "";
            this.inputMinLen.value = String(minLen || 0);
            this.chkAiFilter.checked = !!aiEnabled;
            this.inputAiApiUrl.value = normalizeAiApiBaseUrl(aiApiUrl || "");
            this.inputAiApiKey.value = aiApiKey || "";
            this.inputAiModelId.value = aiModelId || "";
            this.selObsImgMode.value = obsImgMode || DEFAULTS.obsImgMode;
            this.inputObsApiUrl.value = normalizeObsidianApiUrl(obsApiUrl || "");
            this.inputObsApiKey.value = obsApiKey || "";
            this.obsImgDirWrap.style.display = obsImgMode === "file" ? "" : "none";
            this.syncObsidianLocationUi();

            const collapsed = GM_getValue(K.PANEL_COLLAPSED, true);
            this.bubbleY = this.normalizeBubbleY(GM_getValue(K.BUBBLE_Y, null));
            this.syncBubblePosition(false);
            this.setPanelOpen(!collapsed);
            this.bindBubbleDrag();
            if (!this.handleViewportResize) {
                this.handleViewportResize = () => {
                    this.syncBubblePosition(true);
                    if (this.isPanelOpen()) {
                        this.syncPanelPosition();
                    }
                };
                window.addEventListener("resize", this.handleViewportResize);
            }
            this.bubbleBtn.addEventListener("click", () => {
                if (Date.now() < this.bubbleSuppressClickUntil) return;
                this.setPanelOpen(true);
            });
            this.btnCollapsePanel.addEventListener("click", () => {
                this.setPanelOpen(false);
            });

            const obsPanelOpen = GM_getValue(K.OBS_PANEL_OPEN, false);
            const obsApiKeyEmpty = !GM_getValue(K.OBS_API_KEY, "");
            if (obsApiKeyEmpty || obsPanelOpen) {
                this.obsidianWrap.style.display = "";
                this.obsidianArrow.textContent = "▴";
            }
            this.btnObsidianToggle.addEventListener("click", () => {
                const open = this.obsidianWrap.style.display !== "none";
                this.obsidianWrap.style.display = open ? "none" : "";
                this.obsidianArrow.textContent = open ? "▾" : "▴";
                GM_setValue(K.OBS_PANEL_OPEN, !open);
            });

            const templatePanelOpen = GM_getValue(K.EXPORT_STYLE_OPEN, true);
            if (!templatePanelOpen) {
                this.exportStyleWrap.style.display = "none";
                this.templateArrow.textContent = "▾";
            }
            this.btnTemplateToggle.addEventListener("click", () => {
                const open = this.exportStyleWrap.style.display !== "none";
                this.exportStyleWrap.style.display = open ? "none" : "";
                this.templateArrow.textContent = open ? "▾" : "▴";
                GM_setValue(K.EXPORT_STYLE_OPEN, !open);
            });

            this.selExportTemplate.addEventListener("change", () => {
                const template = normalizeExportTemplate(this.selExportTemplate.value);
                GM_setValue(K.EXPORT_TEMPLATE, template);
                this.syncExportTemplateUi();
            });

            const saveRange = () => {
                const mode = this.selRangeMode.value === "range" ? "range" : "all";
                const start = clampInt(this.inputRangeStart.value, 1, 999999, DEFAULTS.rangeStart);
                const end = clampInt(this.inputRangeEnd.value, 1, 999999, DEFAULTS.rangeEnd);
                GM_setValue(K.RANGE_MODE, mode);
                GM_setValue(K.RANGE_START, start);
                GM_setValue(K.RANGE_END, end);
                const disabled = mode !== "range";
                this.inputRangeStart.disabled = disabled;
                this.inputRangeEnd.disabled = disabled;
                this.inputRangeStart.style.opacity = disabled ? "0.55" : "1";
                this.inputRangeEnd.style.opacity = disabled ? "0.55" : "1";
            };
            this.selRangeMode.addEventListener("change", saveRange);
            this.inputRangeStart.addEventListener("change", saveRange);
            this.inputRangeEnd.addEventListener("change", saveRange);
            saveRange();

            const saveFilters = () => {
                GM_setValue(K.FILTER_ONLY_OP, !!this.chkOnlyOp.checked);
                GM_setValue(K.FILTER_IMG, this.selImgFilter.value || "none");
                GM_setValue(K.FILTER_USERS, this.inputUsers.value || "");
                GM_setValue(K.FILTER_INCLUDE, this.inputInclude.value || "");
                GM_setValue(K.FILTER_EXCLUDE, this.inputExclude.value || "");
                GM_setValue(K.FILTER_MINLEN, clampInt(this.inputMinLen.value, 0, 999999, 0));
            };
            [this.chkOnlyOp].forEach((el) => el.addEventListener("change", saveFilters));
            [this.selImgFilter].forEach((el) => el.addEventListener("change", saveFilters));
            [this.inputUsers, this.inputInclude, this.inputExclude, this.inputMinLen].forEach((el) => el.addEventListener("change", saveFilters));
            this.chkAiFilter.addEventListener("change", () => {
                GM_setValue(K.AI_FILTER_ENABLED, !!this.chkAiFilter.checked);
                this.syncAiFilterUi();
            });
            this.inputAiApiUrl.addEventListener("change", () => {
                persistAiApiUrl(this.inputAiApiUrl.value || "");
            });
            this.inputAiApiKey.addEventListener("change", () => GM_setValue(K.AI_API_KEY, this.inputAiApiKey.value || ""));
            this.inputAiModelId.addEventListener("change", () => GM_setValue(K.AI_MODEL_ID, this.inputAiModelId.value || ""));

            this.selObsRoot.addEventListener("change", () => {
                this.persistObsidianLocationConfig({
                    currentRoot: this.selObsRoot.value || DEFAULTS.obsRoot,
                });
                this.scheduleObsidianOverviewRefresh();
            });
            this.btnAddObsRoot.addEventListener("click", () => this.handleAddObsRoot());
            this.btnManageObsRoots.addEventListener("click", () => this.handleManageObsRoots());

            this.selObsCategory.addEventListener("change", () => {
                this.persistObsidianLocationConfig({
                    currentCategory: this.selObsCategory.value || DEFAULTS.obsCategory,
                });
                this.scheduleObsidianOverviewRefresh();
            });
            this.btnAddObsCategory.addEventListener("click", () => this.handleAddObsCategory());
            this.btnManageObsCategories.addEventListener("click", () => this.handleManageObsCategories());

            this.inputObsImgDir.addEventListener("change", () => {
                const normalized = normalizeImageDirValue(this.inputObsImgDir.value || "");
                if (!normalized) {
                    this.setStatus("⚠️ 图片目录必须是相对路径，且不能包含 . 或 ..", "#facc15");
                    this.syncObsidianLocationUi();
                    return;
                }
                this.persistObsidianLocationConfig({
                    imgDirRaw: normalized,
                    imgDirKind: OBS_IMG_DIR_KIND.RELATIVE,
                });
            });
            this.inputObsApiUrl.addEventListener("change", () => {
                persistObsidianApiUrl(this.inputObsApiUrl.value || DEFAULTS.obsApiUrl);
                this.scheduleObsidianOverviewRefresh();
            });
            this.inputObsApiKey.addEventListener("change", () => {
                GM_setValue(K.OBS_API_KEY, this.inputObsApiKey.value || "");
                this.scheduleObsidianOverviewRefresh();
            });
            this.selObsImgMode.addEventListener("change", () => {
                const mode = this.selObsImgMode.value;
                GM_setValue(K.OBS_IMG_MODE, mode);
                this.obsImgDirWrap.style.display = mode === "file" ? "" : "none";
            });
            this.syncExportTemplateUi();
            this.syncAiFilterUi();
            if (this.bubbleBtn && this.bubbleLabel) {
                const hostname = String(window.location.hostname || "").trim();
                this.bubbleLabel.textContent = hostname ? `Discourse2MD · ${hostname}` : `Discourse2MD` ;
                this.bubbleBtn.setAttribute("aria-label", this.bubbleLabel.textContent);
            }

            this.setProgress(0, 1, "准备就绪");
            this.setStatus("准备就绪", "#6ee7b7");
            this.clearDownloadFallback();
            this.setBusy(false);
            this.scheduleObsidianOverviewRefresh();
        },

        getSettings() {
            const exportTemplate = normalizeExportTemplate(this.selExportTemplate.value);
            const rangeMode = this.selRangeMode.value === "range" ? "range" : "all";
            const rangeStart = clampInt(this.inputRangeStart.value, 1, 999999, DEFAULTS.rangeStart);
            const rangeEnd = clampInt(this.inputRangeEnd.value, 1, 999999, DEFAULTS.rangeEnd);

            const onlyOp = !!this.chkOnlyOp.checked;
            const imgFilter = this.selImgFilter.value || DEFAULTS.imgFilter;
            const users = this.inputUsers.value || "";
            const include = this.inputInclude.value || "";
            const exclude = this.inputExclude.value || "";
            const minLen = clampInt(this.inputMinLen.value, 0, 999999, 0);
            const aiEnabled = !!this.chkAiFilter.checked;
            const aiApiUrl = normalizeAiApiBaseUrl(this.inputAiApiUrl.value || "");
            const aiApiKey = this.inputAiApiKey.value || "";
            const aiModelId = this.inputAiModelId.value || "";

            const obsidianPaths = resolveObsidianPaths(this.obsidianConfig || getStoredObsidianConfig());
            const obsImgMode = this.selObsImgMode.value || DEFAULTS.obsImgMode;
            const obsApiUrl = normalizeObsidianApiUrl(this.inputObsApiUrl.value || DEFAULTS.obsApiUrl);
            const obsApiKey = this.inputObsApiKey.value || "";

            return {
                exportTemplate,
                rangeMode,
                rangeStart,
                rangeEnd,
                filters: { onlyOp, imgFilter, users, include, exclude, minLen },
                ai: { enabled: aiEnabled, apiUrl: aiApiUrl, apiKey: aiApiKey, modelId: aiModelId },
                obsidian: {
                    root: obsidianPaths.root,
                    category: obsidianPaths.category,
                    dir: obsidianPaths.dir,
                    imgMode: obsImgMode,
                    imgDirRaw: obsidianPaths.imgDirRaw,
                    imgDirKind: obsidianPaths.imgDirKind,
                    imgDir: obsidianPaths.imgDir,
                    apiUrl: obsApiUrl,
                    apiKey: obsApiKey,
                },
            };
        },

        setProgress(completed, total, stageText) {
            if (!this.panelRoot) this.init();
            total = total || 1;
            const percent = Math.round((completed / total) * 100);
            this.progressBar.style.width = percent + "%";
            this.progressText.textContent = `${stageText} (${completed}/${total}，${percent}%)`;
        },

        setStatus(msg, color) {
            if (!this.panelRoot) this.init();
            const tone = this.getStatusTone(msg, color);
            this.statusText.textContent = msg;
            this.statusText.style.color = this.getStatusColor(tone, color);
            if (this.statusCard) {
                this.statusCard.dataset.tone = tone;
            }
        },

        setBusy(busy) {
            if (!this.panelRoot) this.init();
            this.isBusy = !!busy;
            [
                this.bubbleBtn,
                this.btnCollapsePanel,
                this.btnAddObsRoot,
                this.btnManageObsRoots,
                this.btnAddObsCategory,
                this.btnManageObsCategories,
                this.selObsRoot,
                this.selObsCategory,
                this.selObsImgMode,
                this.inputObsImgDir,
                this.inputObsApiUrl,
                this.inputObsApiKey,
                this.selExportTemplate,
                this.selRangeMode,
                this.inputRangeStart,
                this.inputRangeEnd,
                this.chkOnlyOp,
                this.selImgFilter,
                this.inputUsers,
                this.inputInclude,
                this.inputExclude,
                this.inputMinLen,
                this.chkAiFilter,
                this.inputAiApiUrl,
                this.inputAiApiKey,
                this.inputAiModelId,
                this.btnObsidianToggle,
                this.btnTemplateToggle,
            ]
                .filter(Boolean)
                .forEach((control) => this.applyControlDisabled(control, this.isBusy));
            this.syncActionAvailability();
            this.panelRoot.classList.toggle("is-busy", this.isBusy);
        },

        setDownloadFallback(url, filename) {
            if (!this.panelRoot) this.init();
            if (this.downloadFallbackUrl) URL.revokeObjectURL(this.downloadFallbackUrl);
            this.downloadFallbackUrl = url;
            this.downloadFallbackName = filename;
            const wrap = this.panelRoot.querySelector("#ld-fallback-wrap");
            if (wrap) wrap.style.display = "";
            if (this.btnFallback) {
                this.btnFallback.href = url;
                this.btnFallback.download = filename;
                this.btnFallback.textContent = `兜底下载：${filename}`;
            }
        },

        clearDownloadFallback() {
            if (!this.panelRoot) return;
            if (this.downloadFallbackUrl) {
                URL.revokeObjectURL(this.downloadFallbackUrl);
                this.downloadFallbackUrl = null;
                this.downloadFallbackName = null;
            }
            const wrap = this.panelRoot.querySelector("#ld-fallback-wrap");
            if (wrap) wrap.style.display = "none";
            if (this.btnFallback) {
                this.btnFallback.href = "#";
                this.btnFallback.download = "";
                this.btnFallback.textContent = "兜底下载（点击保存）";
            }
        },
    };

    // -----------------------
    // 网络请求
    // -----------------------
    async function fetchJson(url, opts, retries = 2) {
        let lastErr = null;
        for (let i = 0; i <= retries; i += 1) {
            try {
                const res = await fetch(url, opts);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return await res.json();
            } catch (e) {
                lastErr = e;
                if (i < retries) await sleep(250 * (i + 1));
            }
        }
        throw lastErr || new Error("fetchJson failed");
    }

    function gmRequest(details) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "function") {
                reject(new Error("当前脚本环境不支持 GM_xmlhttpRequest"));
                return;
            }

            GM_xmlhttpRequest({
                method: "GET",
                timeout: 45000,
                responseType: "text",
                ...details,
                onload: (response) => resolve(response),
                onerror: (error) => reject(new Error(error?.error || "GM_xmlhttpRequest 请求失败")),
                ontimeout: () => reject(new Error("AI 请求超时")),
            });
        });
    }

    function getRequestOpts() {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
        const headers = { "x-requested-with": "XMLHttpRequest" };
        if (csrf) headers["x-csrf-token"] = csrf;
        return { headers };
    }

    // -----------------------
    // 拉取所有帖子
    // -----------------------
    async function fetchAllPostsDetailed(topicId) {
        const opts = getRequestOpts();

        const idData = await fetchJson(
            `${window.location.origin}/t/${topicId}/post_ids.json?post_number=0&limit=99999`,
            opts
        );
        let postIds = idData.post_ids || [];

        const mainData = await fetchJson(`${window.location.origin}/t/${topicId}.json`, opts);
        const mainFirstPost = mainData.post_stream?.posts?.[0];
        if (mainFirstPost && !postIds.includes(mainFirstPost.id)) postIds.unshift(mainFirstPost.id);

        const opUsername =
            mainData?.details?.created_by?.username ||
            mainData?.post_stream?.posts?.[0]?.username ||
            "";

        const domCategory = document.querySelector(".badge-category__name")?.textContent?.trim() || "";
        const domTags = Array.from(document.querySelectorAll(".discourse-tag"))
            .map((t) => t.textContent.trim())
            .filter(Boolean);

        const topic = {
            topicId: String(topicId || ""),
            title: mainData?.title ? String(mainData.title) : document.title,
            category: domCategory,
            tags:
                (Array.isArray(mainData?.tags) && mainData.tags.length
                    ? mainData.tags.map((t) =>
                        typeof t === "object" && t ? t.name || String(t) : String(t)
                    )
                    : domTags) || [],
            url: window.location.href,
            opUsername: opUsername || "",
        };

        let allPosts = [];
        for (let i = 0; i < postIds.length; i += 200) {
            const chunk = postIds.slice(i, i + 200);
            const q = chunk.map((id) => `post_ids[]=${encodeURIComponent(id)}`).join("&");
            const data = await fetchJson(
                `${window.location.origin}/t/${topicId}/posts.json?${q}&include_suggested=false`,
                opts
            );
            const posts = data.post_stream?.posts || [];
            allPosts = allPosts.concat(posts);
            ui.setProgress(Math.min(i + 200, postIds.length), postIds.length, "拉取帖子数据");
        }

        allPosts.sort((a, b) => a.post_number - b.post_number);
        return { topic, posts: allPosts };
    }

    // -----------------------
    // 筛选
    // -----------------------
    function postHasImageFast(post) {
        const cooked = post?.cooked || "";
        return cooked.includes("<img");
    }

    function buildPlainCache(posts) {
        const cache = new Map();
        for (const p of posts) {
        const text = cookedToMarkdown(p.cooked || "", {}, {});
            cache.set(p.id, text || "");
        }
        return cache;
    }

    function splitPinnedFirstPost(posts) {
        const primaryPost = getPrimaryPost(posts);
        if (!primaryPost) {
            return { firstPost: null, remainingPosts: [] };
        }

        const remainingPosts = (Array.isArray(posts) ? posts : []).filter((post) => post?.id !== primaryPost.id);
        return { firstPost: primaryPost, remainingPosts };
    }

    function applyFiltersToNonFirstPosts(topic, posts, settings) {
        const { rangeMode, rangeStart, rangeEnd, filters } = settings;
        const op = (topic.opUsername || "").toLowerCase();

        const wantUsers = new Set(normalizeListInput(filters.users).map((u) => u.toLowerCase()));
        const includeKws = normalizeListInput(filters.include);
        const excludeKws = normalizeListInput(filters.exclude);
        const minLen = clampInt(filters.minLen, 0, 999999, 0);

        const needTextCheck = includeKws.length > 0 || excludeKws.length > 0 || minLen > 0;
        const plainCache = needTextCheck ? buildPlainCache(posts) : null;

        const inRange = (n) => {
            if (rangeMode !== "range") return true;
            return n >= rangeStart && n <= rangeEnd;
        };

        const matchKeywords = (txt, kws) => {
            if (!kws.length) return true;
            const low = txt.toLowerCase();
            return kws.some((k) => low.includes(k.toLowerCase()));
        };

        const hitExclude = (txt, kws) => {
            if (!kws.length) return false;
            const low = txt.toLowerCase();
            return kws.some((k) => low.includes(k.toLowerCase()));
        };

        const selectedPosts = [];
        for (const p of posts) {
            const pn = p.post_number || 0;
            if (!inRange(pn)) continue;

            if (filters.onlyOp && op) {
                if ((p.username || "").toLowerCase() !== op) continue;
            }

            if (wantUsers.size) {
                if (!wantUsers.has((p.username || "").toLowerCase())) continue;
            }

            if (filters.imgFilter === "withImg") {
                if (!postHasImageFast(p)) continue;
            } else if (filters.imgFilter === "noImg") {
                if (postHasImageFast(p)) continue;
            }

            if (needTextCheck) {
                const txt = plainCache.get(p.id) || "";
                if (minLen > 0 && txt.replace(/\s+/g, "").length < minLen) continue;
                if (!matchKeywords(txt, includeKws)) continue;
                if (hitExclude(txt, excludeKws)) continue;
            }

            selectedPosts.push(p);
        }

        return { selectedPosts, opUsername: topic.opUsername || "" };
    }

    function getPrimaryPost(posts) {
        const list = Array.isArray(posts) ? posts.slice() : [];
        if (!list.length) return null;

        const exactFirstPost = list.find((post) => Number(post?.post_number || 0) === 1);
        if (exactFirstPost) return exactFirstPost;

        list.sort((a, b) => (a?.post_number || 0) - (b?.post_number || 0));
        return list[0] || null;
    }

    function mergeFirstPostBack(firstPost, posts) {
        const merged = [];
        if (firstPost) merged.push(firstPost);

        for (const post of Array.isArray(posts) ? posts : []) {
            if (firstPost && post?.id === firstPost.id) continue;
            merged.push(post);
        }

        return merged.sort((a, b) => (a?.post_number || 0) - (b?.post_number || 0));
    }

    function normalizeFilterText(text) {
        return String(text || "").replace(/\s+/g, " ").trim();
    }

    function truncateFilterText(text, maxLength) {
        const normalized = normalizeFilterText(text);
        if (!normalized) return "";
        return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
    }

    const LOCAL_META_ONLY_PATTERNS = [
        /^(?:mark|收藏|已读|读完|看完|围观|路过|顶帖?|帮顶|先码住|码住|dd|up)\W*$/i,
        /(转载|转发|搬运|出处|注明出处|授权|署名|二传)/i,
        /(文风|用词|文笔|表达方式|作者气质|思维树)/i,
        /(感谢(?:大佬|佬友)?分享|多谢(?:分享)?|谢谢(?:分享)?|全是干货|干货满满|写得真(?:挺)?好|写的真(?:挺)?好|思路完整|逐字阅读|已逐字阅读|味道好太多了|真挺好)/i,
    ];
    const LOCAL_SUBSTANTIVE_PATTERNS = [
        /```|`[^`]+`/,
        /(https?:\/\/|www\.)/i,
        /(报错|错误|异常|复现|配置|参数|代码|脚本|命令|数据|实验|benchmark|基准|公式|步骤|补充|纠错|更正|反例|边界|限制|前提|对比|性能|延迟|显存|我实测|我测试了|我观察到)/i,
        /((为什么|如何|怎么|能否|是否|请问).{0,24}(实现|配置|参数|上下文|窗口|token|prompt|训练|推理|部署|复现|兼容|步骤|代码|细节|原理|区别))/i,
        /(第.{0,8}(节|段|部分).{0,12}(疑问|问题|没看懂|看不懂|是什么意思|如何|为什么))/i,
    ];

    function isLikelyLocalMetaOnlyReply(text) {
        const normalized = normalizeFilterText(text);
        if (!normalized) return false;

        if (LOCAL_SUBSTANTIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
            return false;
        }

        return LOCAL_META_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
    }

    function buildTopicContext(firstPost) {
        if (!firstPost) return "";
        const bodyText = cookedToMarkdown(firstPost.cooked || "", {}, {});
        return truncateFilterText(bodyText, 800);
    }

    function applyLocalMetaCommentaryFilter(posts, plainCache) {
        const selectedPosts = [];
        let removedCount = 0;

        for (const post of Array.isArray(posts) ? posts : []) {
            const text = plainCache?.get(post?.id) || "";
            if (isLikelyLocalMetaOnlyReply(text)) {
                removedCount += 1;
                continue;
            }
            selectedPosts.push(post);
        }

        return { selectedPosts, removedCount };
    }

    const AI_FILTER_BATCH_SIZE = 15;
    const AI_FILTER_MAX_TEXT_LENGTH = 220;
    const AI_FILTER_SYSTEM_PROMPT = [
        "你是论坛回帖筛选器，任务是找出不推进主贴理解的非首帖楼层。",
        "输入中不包含首帖，首帖已经固定保留；你只能判断 posts 里的候选楼层。",
        "判断标准是是否推进主题理解，而不是是否和标题表面相关。",
        "凡是纯夸赞、纯感谢、作者/文风/表达方式的元评论、转载/出处/授权问题、已读打卡、纯附和、泛泛而谈但没有新增事实或具体问题的回复，都判为无效。",
        "如果回复提供了补充事实、经验、数据、步骤、配置、代码、链接说明、纠错，或提出围绕主贴技术内容的具体问题、反驳、延伸、边界条件，则必须保留。",
        "不要因为出现主题关键词就保留；如果只是复述概念或泛泛附和，没有新增具体信息，也应判无效。",
        "不要因为回复较短就自动判无效；不确定时保留。",
        "无效示例：",
        "1. 啊，好文，现在确实是Contenxt IS ALL You Need。最好是在现有的几个模型的上下文甜点区做好",
        "2. 感谢大佬分享。这是我喜欢看的文章，思路完整，又有实操细节。比各种AI拼凑的格式完美味道好太多了。",
        "3. 看用词和文风就能判断出佬友一定经常 review GPT 5.4 的思维树）",
        "4. 这写的是真挺好，请问佬这篇文章能转载吗，会注明出处作者",
        "5. 全是干货，多谢佬友整理的AI 4 Science经验，已逐字阅读。",
        "保留示例：",
        "1. 感谢分享，但这里第 3 节关于上下文窗口我有个疑问：如果换成 128k 模型，实验结论还成立吗？",
        "2. 我实测了一下，文中的配置在 70B 模型上会 OOM，需要把 batch size 降到 2。",
        "3. 第 2 段有个细节可能不对，KV cache 的描述和后面的推理步骤冲突了。",
        "只输出严格 JSON，格式必须是 {\"invalid_indexes\":[0,1]}。",
        "不要输出解释、不要输出 Markdown、不要补充其他字段。",
    ].join("\n");

    function sanitizeAiExcerpt(text, maxLength = AI_FILTER_MAX_TEXT_LENGTH) {
        return truncateFilterText(text, maxLength);
    }

    function buildAiBatchItems(posts, plainCache) {
        return posts.map((post, index) => ({
            i: index,
            f: Number(post?.post_number || 0),
            u: String(post?.username || ""),
            r: Number(post?.reply_to_post_number || 0),
            img: postHasImageFast(post) ? 1 : 0,
            t: sanitizeAiExcerpt(plainCache.get(post?.id) || ""),
        }));
    }

    function extractChatCompletionText(data) {
        const choice = data?.choices?.[0];
        if (!choice) return "";

        const messageContent = choice?.message?.content;
        if (typeof messageContent === "string") return messageContent;
        if (Array.isArray(messageContent)) {
            return messageContent
                .map((part) => {
                    if (typeof part === "string") return part;
                    if (typeof part?.text === "string") return part.text;
                    return "";
                })
                .join("");
        }

        if (typeof choice?.text === "string") return choice.text;
        return "";
    }

    function stripAiResponseWrapper(text) {
        const trimmed = String(text || "").trim();
        if (!trimmed) return "";

        const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        return fencedMatch ? fencedMatch[1].trim() : trimmed;
    }

    function parseAiInvalidIndexes(rawText, batchSize) {
        const cleaned = stripAiResponseWrapper(rawText);
        const candidates = [cleaned];
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
        }

        let parsed = null;
        for (const candidate of candidates) {
            try {
                parsed = JSON.parse(candidate);
                break;
            } catch {
                // ignore and try next candidate
            }
        }

        if (!parsed || !Array.isArray(parsed.invalid_indexes)) {
            throw new Error("AI 返回内容不是预期 JSON");
        }

        const deduped = [];
        const seen = new Set();
        for (const item of parsed.invalid_indexes) {
            if (!Number.isInteger(item) || item < 0 || item >= batchSize) {
                throw new Error("AI 返回了非法 index");
            }
            if (seen.has(item)) continue;
            seen.add(item);
            deduped.push(item);
        }

        return deduped.sort((a, b) => a - b);
    }

    async function requestAiFilterBatch(topic, topicContext, batchItems, settings) {
        const apiUrl = normalizeAiApiBaseUrl(settings?.ai?.apiUrl || "");
        const apiKey = settings?.ai?.apiKey || "";
        const modelId = String(settings?.ai?.modelId || "").trim();
        if (!apiUrl || !apiKey || !modelId) {
            throw new Error("AI 过滤配置不完整");
        }

        const payload = {
            model: modelId,
            temperature: 0,
            stream: false,
            messages: [
                { role: "system", content: AI_FILTER_SYSTEM_PROMPT },
                {
                    role: "user",
                    content: JSON.stringify({
                        topic_title: String(topic?.title || ""),
                        topic_context: String(topicContext || ""),
                        rule: "判断标准是这些回复是否推进主贴理解；纯夸赞、纯感谢、元评论、转载/出处询问、已读打卡、泛泛附和但无新增信息都算无效。",
                        note: "首帖已固定保留且不在候选列表中。请只返回应排除的 posts[].i。",
                        posts: batchItems,
                    }),
                },
            ],
        };

        const response = await gmRequest({
            method: "POST",
            url: joinAiApiUrl(apiUrl, "/chat/completions"),
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            data: JSON.stringify(payload),
        });

        if (response.status < 200 || response.status >= 300) {
            let detail = "";
            try {
                const errorPayload = JSON.parse(response.responseText || "{}");
                detail = errorPayload?.error?.message || errorPayload?.message || "";
            } catch {
                detail = "";
            }
            const suffix = detail ? ` - ${detail}` : "";
            throw new Error(`AI 接口请求失败: HTTP ${response.status}${suffix}`);
        }

        let data = null;
        try {
            data = JSON.parse(response.responseText || "{}");
        } catch {
            throw new Error("AI 接口返回了非 JSON 响应");
        }

        const content = extractChatCompletionText(data);
        if (!content) {
            throw new Error("AI 未返回可解析内容");
        }

        return parseAiInvalidIndexes(content, batchItems.length);
    }

    async function runAiFilterOnNonFirstCandidates(topic, topicContext, posts, settings, plainCache) {
        const candidates = Array.isArray(posts) ? posts.slice() : [];
        if (!candidates.length) {
            return { selectedPosts: [], applied: false, removedCount: 0 };
        }

        const cache = plainCache || buildPlainCache(candidates);
        const selectedPosts = [];
        let removedCount = 0;
        const totalBatches = Math.ceil(candidates.length / AI_FILTER_BATCH_SIZE);

        ui.setStatus("正在用 AI 过滤无效楼层…", "#a855f7");
        ui.setProgress(0, totalBatches || 1, "AI 过滤");

        for (let start = 0; start < candidates.length; start += AI_FILTER_BATCH_SIZE) {
            const batchIndex = Math.floor(start / AI_FILTER_BATCH_SIZE);
            const batchPosts = candidates.slice(start, start + AI_FILTER_BATCH_SIZE);
            const batchItems = buildAiBatchItems(batchPosts, cache);
            const invalidIndexes = await requestAiFilterBatch(topic, topicContext, batchItems, settings);
            const invalidSet = new Set(invalidIndexes);

            batchPosts.forEach((post, index) => {
                if (invalidSet.has(index)) {
                    removedCount += 1;
                    return;
                }
                selectedPosts.push(post);
            });

            ui.setProgress(batchIndex + 1, totalBatches, "AI 过滤");
        }

        return { selectedPosts, applied: true, removedCount };
    }

    function buildFilterSummary(settings, topic, options = {}) {
        const { rangeMode, rangeStart, rangeEnd, filters } = settings;
        const keepFirstPost = options.keepFirstPost !== false;
        const localRemovedCount = clampInt(options.localRemovedCount, 0, 999999, 0);
        const aiApplied = !!options.aiApplied;
        const aiRemovedCount = clampInt(options.aiRemovedCount, 0, 999999, 0);
        const parts = [];
        if (keepFirstPost) parts.push("首帖=强制保留");
        parts.push(rangeMode === "range" ? `范围=${rangeStart}-${rangeEnd}` : "范围=全部");
        if (filters.onlyOp) parts.push(`只楼主=@${topic.opUsername || "OP"}`);
        if (filters.imgFilter === "withImg") parts.push("仅含图");
        if (filters.imgFilter === "noImg") parts.push("仅无图");
        if ((filters.users || "").trim()) parts.push(`用户=${filters.users.trim()}`);
        if ((filters.include || "").trim()) parts.push(`包含=${filters.include.trim()}`);
        if ((filters.exclude || "").trim()) parts.push(`排除=${filters.exclude.trim()}`);
        if ((filters.minLen || 0) > 0) parts.push(`最短=${filters.minLen}`);
        if (localRemovedCount > 0) parts.push(`元评论过滤=${localRemovedCount}条`);
        if (aiApplied) parts.push(`AI过滤=剔除${aiRemovedCount}条`);
        return parts.join("；");
    }

    // -----------------------
    // 图片处理
    // -----------------------
    async function imageUrlToBase64(url) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const blob = await res.blob();

            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            return dataUrl;
        } catch (e) {
            console.error("图片转换失败:", url, e);
            return url;
        }
    }

    function collectImageUrlsFromPosts(posts) {
        const urlSet = new Set();

        for (const p of posts) {
            const div = document.createElement("div");
            div.innerHTML = p.cooked || "";
            div.querySelectorAll("img").forEach((img) => {
                const src = img.getAttribute("src") || img.getAttribute("data-src") || "";
                if (isDiscourseEmojiImage(src)) return;

                const full = absoluteUrl(src);
                if (full) urlSet.add(full);

                const a = img.closest("a");
                if (a) {
                    const href = a.getAttribute("href") || "";
                    const h = absoluteUrl(href);
                    if (h && /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(h)) urlSet.add(h);
                }
            });
        }

        return Array.from(urlSet);
    }

    // -----------------------
    // Obsidian API
    // -----------------------
    function getObsidianVaultEndpoint(path, isDirectory) {
        const normalized = normalizeVaultPath(path);
        if (!normalized) return "/vault/";
        const suffix = isDirectory ? "/" : "";
        return `/vault/${encodeVaultPath(normalized)}${suffix}`;
    }

    async function createObsidianHttpError(actionText, response, effectiveApiUrl) {
        const text = await response.text().catch(() => "");
        const message = `${actionText}失败: ${response.status} ${response.statusText} (${effectiveApiUrl}) ${text}`.trim();
        const error = new Error(message);
        error.status = response.status;
        error.effectiveApiUrl = effectiveApiUrl;
        return error;
    }

    async function listObsidianDirectory(path, settings) {
        const { response, effectiveApiUrl, fallbackUsed } = await requestObsidian(
            getObsidianVaultEndpoint(path, true),
            {
                method: "GET",
                headers: {
                    Accept: "application/json",
                },
            },
            settings
        );

        if (response.status === 404) {
            return { files: [], notFound: true, effectiveApiUrl, fallbackUsed };
        }
        if (!response.ok) {
            throw await createObsidianHttpError("读取目录", response, effectiveApiUrl);
        }

        const payload = await response.json().catch(() => ({}));
        const files = Array.isArray(payload?.files)
            ? payload.files.map((item) => String(item || "").trim()).filter(Boolean)
            : [];

        return { files, notFound: false, effectiveApiUrl, fallbackUsed };
    }

    async function readObsidianNoteJson(path, settings) {
        const { response, effectiveApiUrl, fallbackUsed } = await requestObsidian(
            getObsidianVaultEndpoint(path, false),
            {
                method: "GET",
                headers: {
                    Accept: "application/vnd.olrapi.note+json",
                },
            },
            settings
        );

        if (response.status === 404) {
            return { note: null, notFound: true, effectiveApiUrl, fallbackUsed };
        }
        if (!response.ok) {
            throw await createObsidianHttpError("读取笔记", response, effectiveApiUrl);
        }

        const note = await response.json().catch(() => null);
        return { note, notFound: false, effectiveApiUrl, fallbackUsed };
    }

    async function listMarkdownFilesRecursive(baseDir, settings) {
        const normalizedBaseDir = normalizeVaultPath(baseDir);
        if (!normalizedBaseDir) {
            return { paths: [], notFound: false };
        }

        const queue = [normalizedBaseDir];
        const visited = new Set();
        const paths = [];

        while (queue.length > 0) {
            const currentDir = queue.shift();
            if (!currentDir || visited.has(normalizeCaseKey(currentDir))) continue;
            visited.add(normalizeCaseKey(currentDir));

            const directoryResult = await listObsidianDirectory(currentDir, settings);
            if (directoryResult.notFound) {
                if (normalizeCaseKey(currentDir) === normalizeCaseKey(normalizedBaseDir)) {
                    return { paths: [], notFound: true };
                }
                continue;
            }

            for (const entry of directoryResult.files) {
                if (!entry) continue;
                if (entry.endsWith("/")) {
                    const nextDir = joinVaultPath(currentDir, entry.slice(0, -1));
                    if (nextDir) queue.push(nextDir);
                    continue;
                }

                if (/\.md$/i.test(entry)) {
                    paths.push(joinVaultPath(currentDir, entry));
                }
            }
        }

        return { paths, notFound: false };
    }

    async function scanTopicNotesUnderDirectory(baseDir, settings) {
        const tree = await listMarkdownFilesRecursive(baseDir, settings);
        if (tree.notFound) {
            return { records: [], notFound: true };
        }

        const records = [];
        for (const path of tree.paths) {
            const noteResult = await readObsidianNoteJson(path, settings);
            if (noteResult.notFound || !noteResult.note) continue;

            const topicId = extractTopicIdFromNoteJson(noteResult.note);
            if (!topicId) continue;

            records.push({
                path,
                topicId,
            });
        }

        return { records, notFound: false };
    }

    async function writeToObsidian(path, content, settings) {
        const { response, effectiveApiUrl, fallbackUsed } = await requestObsidian(
            getObsidianVaultEndpoint(path, false),
            {
                method: "PUT",
                headers: {
                    "Content-Type": "text/markdown",
                },
                body: content,
            },
            settings
        );

        if (!response.ok) {
            throw await createObsidianHttpError("写入笔记", response, effectiveApiUrl);
        }
        return { response, effectiveApiUrl, fallbackUsed };
    }

    async function writeImageToObsidian(path, blob, settings) {
        const { response, effectiveApiUrl, fallbackUsed } = await requestObsidian(
            getObsidianVaultEndpoint(path, false),
            {
                method: "PUT",
                headers: {
                    "Content-Type": blob.type || "application/octet-stream",
                },
                body: blob,
            },
            settings
        );

        if (!response.ok) {
            throw await createObsidianHttpError("写入图片", response, effectiveApiUrl);
        }
        return { response, effectiveApiUrl, fallbackUsed };
    }

    async function testObsidianConnection() {
        const settings = ui.getSettings();
        const btn = ui.btnTestConnection;

        if (!settings.obsidian.apiKey) {
            ui.setStatus("⚠️ 请先填写 API Key", "#facc15");
            return;
        }

        const originalText = btn.textContent;
        const originalStyle = btn.style.cssText;

        btn.textContent = "连接中...";
        btn.disabled = true;
        btn.style.background = "rgba(250, 250, 250, 0.04)";
        btn.style.borderColor = "#363636";
        btn.style.color = "#fafafa";
        btn.style.opacity = "0.7";

        try {
            const { response, effectiveApiUrl, fallbackUsed } = await requestObsidian(
                "/vault/",
                { method: "GET" },
                settings
            );

            if (response.ok) {
                btn.textContent = fallbackUsed ? "✓ 已回退 HTTP" : "✓ 连接成功";
                btn.style.background = "rgba(62, 207, 142, 0.16)";
                btn.style.color = "#fafafa";
                btn.style.borderColor = "rgba(62, 207, 142, 0.35)";
                btn.style.opacity = "1";
                ui.setStatus(`✅ Obsidian 连接正常：${effectiveApiUrl}`, "#6ee7b7");
                ui.scheduleObsidianOverviewRefresh();
            } else if (response.status === 401 || response.status === 403) {
                throw new Error("API Key 无效");
            } else {
                throw new Error(`HTTP ${response.status} (${effectiveApiUrl})`);
            }
        } catch (e) {
            btn.textContent = "✗ " + (e?.message || "连接失败");
            btn.style.background = "rgba(210, 93, 120, 0.16)";
            btn.style.color = "#fafafa";
            btn.style.borderColor = "rgba(210, 93, 120, 0.35)";
            btn.style.opacity = "1";
            ui.setStatus(`❌ 连接失败: ${e?.message || e}`, "#fecaca");
            ui.scheduleObsidianOverviewRefresh();
        }

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.cssText = originalStyle;
            ui.syncActionAvailability();
        }, 3000);
    }

    // -----------------------
    // Markdown 生成
    // -----------------------
    function escapeYaml(str) {
        return String(str || "").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    }

    function generateMarkdownDocument(topic, posts, settings, imgMap, filterSummary) {
        const now = new Date();
        const exportTemplate = normalizeExportTemplate(settings?.exportTemplate);

        const allTags = [...new Set([...(topic.tags || []), "linuxdo"])];
        const tagsYaml = allTags.map((t) => `  - "${escapeYaml(t)}"`).join("\n");

        const frontmatter = `---
title: "${escapeYaml(topic.title || "")}"
topic_id: ${topic.topicId || 0}
url: "${topic.url || ""}"
author: "${escapeYaml(topic.opUsername || "")}"
category: "${escapeYaml(topic.category || "")}"
tags:
${tagsYaml}
export_time: "${now.toISOString()}"
floors: ${posts.length}
---

`;

        let content = `# ${topic.title || "无标题"}\n\n`;
        content += `> [!info] 帖子信息\n`;
        content += `> - **原始链接**: [${topic.url || ""}](${topic.url || ""})\n`;
        content += `> - **主题 ID**: ${topic.topicId || 0}\n`;
        content += `> - **楼主**: @${topic.opUsername || "未知"}\n`;
        content += `> - **分类**: ${topic.category || "无"}\n`;
        content += `> - **标签**: ${allTags.join(", ")}\n`;
        content += `> - **导出时间**: ${now.toLocaleString("zh-CN")}\n`;
        content += `> - **楼层数**: ${posts.length}\n`;
        if (exportTemplate === "forum" && filterSummary) {
            content += `> - **筛选条件**: ${filterSummary}\n`;
        }
        content += "\n";

        if (exportTemplate === "clean") {
            const primaryPost = getPrimaryPost(posts);
            if (!primaryPost) throw new Error("未找到首帖，无法按纯净风格导出");

            const bodyMd = renderPrimaryPostMarkdown(primaryPost, settings, imgMap);
            if (bodyMd) {
                content += `${bodyMd}\n`;
            }
            return frontmatter + content;
        }

        const { firstPost, remainingPosts } = splitPinnedFirstPost(posts);
        if (!firstPost) throw new Error("未找到首帖，无法按论坛风格导出");

        const firstPostMd = renderPrimaryPostMarkdown(firstPost, settings, imgMap, { includeAnchor: true });
        if (firstPostMd) {
            content += `${firstPostMd}\n\n`;
        }

        for (const p of remainingPosts) {
            content += generatePostCallout(p, topic, settings, imgMap);
            content += "\n";
        }

        return frontmatter + content;
    }

    function renderPrimaryPostMarkdown(post, settings, imgMap, options = {}) {
        const bodyMd = cookedToMarkdown(post?.cooked || "", settings, imgMap);
        if (!options.includeAnchor) return bodyMd;

        const anchor = `^floor-${Number(post?.post_number || 1)}`;
        return bodyMd ? `${bodyMd}\n\n${anchor}` : anchor;
    }

    function generatePostCallout(post, topic, settings, imgMap) {
        const isOp = (post.username || "").toLowerCase() === (topic.opUsername || "").toLowerCase();
        const dateStr = post.created_at ? new Date(post.created_at).toLocaleString("zh-CN") : "";

        const calloutType = isOp ? "success" : "note";
        const opBadge = isOp ? " 🏠 楼主" : "";

        let title = `#${post.post_number} ${post.name || post.username || "匿名"}`;
        if (post.name && post.username && post.name !== post.username) {
            title += ` (@${post.username})`;
        }
        title += opBadge;
        if (dateStr) title += ` · ${dateStr}`;

        let md = `> [!${calloutType}]+ ${title}\n`;

        if (post.reply_to_post_number) {
            md += `> > 回复 [[#^floor-${post.reply_to_post_number}|#${post.reply_to_post_number}楼]]\n>\n`;
        }

        const bodyMd = cookedToMarkdown(post.cooked, settings, imgMap);
        const lines = bodyMd.split("\n");
        for (const line of lines) {
            md += `> ${line}\n`;
        }

        md += `> ^floor-${post.post_number}\n`;

        return md;
    }

    function buildDuplicatePathDetails(matches, limit = 3) {
        const items = (Array.isArray(matches) ? matches : [])
            .map((item) => item?.path || item)
            .filter(Boolean)
            .slice(0, limit);

        const remaining = Math.max(0, (Array.isArray(matches) ? matches.length : 0) - items.length);
        if (remaining > 0) {
            items.push(`还有 ${remaining} 条其他命中…`);
        }
        return items;
    }

    async function resolveObsidianExportTargetPath(topic, settings) {
        const topicId = String(topic?.topicId || "");
        const defaultFilename = buildMarkdownFilename(topic);
        const defaultPath = joinVaultPath(settings.obsidian.dir, defaultFilename);

        if (!topicId) {
            return { fullPath: defaultPath, sameCategoryMatch: null, otherMatches: [] };
        }

        ui.setStatus("正在检查重复导出…", "#a855f7");
        const scanResult = await scanTopicNotesUnderDirectory(settings.obsidian.root, settings);
        if (scanResult.notFound) {
            return { fullPath: defaultPath, sameCategoryMatch: null, otherMatches: [] };
        }

        const topicMatches = scanResult.records
            .filter((record) => String(record.topicId) === topicId)
            .sort((a, b) => String(a.path || "").localeCompare(String(b.path || "")));

        const sameCategoryMatches = topicMatches.filter((record) => isPathInside(settings.obsidian.dir, record.path));
        const sameCategoryMatch = sameCategoryMatches[0] || null;

        if (sameCategoryMatch) {
            const confirmed = await ui.showConfirmDialog({
                title: "分类内发现同话题",
                message: "分类下已有相同话题，是否导出？若继续将覆盖原文档。",
                details: buildDuplicatePathDetails(sameCategoryMatches),
                confirmText: "覆盖导出",
                cancelText: "取消",
                danger: true,
            });

            if (!confirmed) {
                return { cancelled: true };
            }
        }

        const otherMatches = topicMatches.filter((record) => !isPathInside(settings.obsidian.dir, record.path));
        if (otherMatches.length > 0) {
            const confirmed = await ui.showConfirmDialog({
                title: "根目录内发现同话题",
                message: "根目录下已有相同话题，是否导出？",
                details: buildDuplicatePathDetails(otherMatches),
                confirmText: "继续导出",
                cancelText: "取消",
            });

            if (!confirmed) {
                return { cancelled: true };
            }
        }

        return {
            fullPath: sameCategoryMatch ? sameCategoryMatch.path : defaultPath,
            sameCategoryMatch,
            otherMatches,
        };
    }

    // -----------------------
    // 导出主流程
    // -----------------------
    function buildExportOutcomeNotes(aiOutcome, extraNotes = []) {
        const notes = Array.isArray(extraNotes) ? [...extraNotes] : [];
        if ((aiOutcome?.localRemovedCount || 0) > 0) notes.push(`元评论过滤${aiOutcome.localRemovedCount}条`);
        if (aiOutcome?.warning) {
            notes.push(aiOutcome.warning);
        } else if (aiOutcome?.applied && (aiOutcome?.removedCount || 0) > 0) {
            notes.push(`AI过滤剔除${aiOutcome.removedCount}条`);
        }
        return notes;
    }

    function openObsidianSettingsPanel() {
        if (!ui.panelRoot) ui.init();
        if (!ui.obsidianWrap || !ui.panelRoot) return;
        ui.setPanelOpen(true);
        ui.obsidianWrap.style.display = "";
        const arrow = ui.obsidianArrow || ui.panelRoot.querySelector("#ld-obsidian-arrow");
        if (arrow) arrow.textContent = "▴";
        GM_setValue(K.OBS_PANEL_OPEN, true);
    }

    async function buildExportContext(target, baseSettings) {
        const exportTarget = target === "markdown" ? "markdown" : "obsidian";
        const topicId = getTopicId();
        if (!topicId) throw new Error("未检测到帖子 ID");

        const settings = buildTargetExportSettings(baseSettings || ui.getSettings(), exportTarget);
        const isCleanTemplate = settings.exportTemplate === "clean";
        const aiConfigMissing = !settings.ai?.apiUrl || !settings.ai?.apiKey || !settings.ai?.modelId;

        if (!isCleanTemplate && settings.rangeMode === "range" && settings.rangeStart > settings.rangeEnd) {
            throw new Error("起始楼层不能大于结束楼层");
        }
        if (!isCleanTemplate && settings.ai?.enabled && aiConfigMissing) {
            throw new Error("请先完整配置 AI 过滤的 API URL、API Key 和 Model ID");
        }

        const data = await fetchAllPostsDetailed(topicId);
        let selected = [];
        let filterSummary = "";
        let aiOutcome = { applied: false, removedCount: 0, localRemovedCount: 0, warning: "" };

        if (isCleanTemplate) {
            const primaryPost = getPrimaryPost(data.posts);
            if (!primaryPost) throw new Error("未找到首帖，无法按纯净风格导出");
            selected = [primaryPost];
        } else {
            const { firstPost, remainingPosts } = splitPinnedFirstPost(data.posts);
            if (!firstPost) throw new Error("未找到首帖，无法导出");

            const { selectedPosts: selectedNonFirstPosts } = applyFiltersToNonFirstPosts(data.topic, remainingPosts, settings);
            let finalNonFirstPosts = selectedNonFirstPosts;
            const topicContext = buildTopicContext(firstPost);

            if (settings.ai?.enabled && selectedNonFirstPosts.length > 0) {
                const plainCache = buildPlainCache(selectedNonFirstPosts);
                const localFilterResult = applyLocalMetaCommentaryFilter(selectedNonFirstPosts, plainCache);
                aiOutcome.localRemovedCount = localFilterResult.removedCount;
                finalNonFirstPosts = localFilterResult.selectedPosts;

                try {
                    if (finalNonFirstPosts.length > 0) {
                        const aiResult = await runAiFilterOnNonFirstCandidates(
                            data.topic,
                            topicContext,
                            finalNonFirstPosts,
                            settings,
                            plainCache
                        );
                        aiOutcome.applied = aiResult.applied;
                        aiOutcome.removedCount = aiResult.removedCount;
                        finalNonFirstPosts = aiResult.selectedPosts;
                    }
                } catch (error) {
                    console.warn("AI 过滤失败:", error);
                    aiOutcome.warning = "AI过滤失败，已按扩展规则继续导出";
                }
            }

            selected = mergeFirstPostBack(firstPost, finalNonFirstPosts);
            filterSummary = buildFilterSummary(settings, data.topic, {
                keepFirstPost: true,
                localRemovedCount: aiOutcome.localRemovedCount,
                aiApplied: aiOutcome.applied,
                aiRemovedCount: aiOutcome.removedCount,
            });
        }

        return {
            target: exportTarget,
            topicId,
            topic: data.topic,
            selected,
            settings,
            filename: buildMarkdownFilename(data.topic),
            filterSummary,
            aiOutcome,
        };
    }

    async function buildImageMapForExport(posts, settings, options = {}) {
        const exportTarget = options?.target === "markdown" ? "markdown" : "obsidian";
        const topicId = String(options?.topicId || "").trim();
        const imgMode = settings?.obsidian?.imgMode || DEFAULTS.obsImgMode;
        const imgUrls = imgMode === "none" ? [] : collectImageUrlsFromPosts(posts);
        const imgMap = {};

        if (imgMode === "base64" && imgUrls.length > 0) {
            ui.setStatus(
                exportTarget === "markdown" ? "正在处理图片（Base64 下载）…" : "正在下载图片（Base64 模式）…",
                "#a855f7"
            );
            let done = 0;
            for (const url of imgUrls) {
                try {
                    const dataUrl = await imageUrlToBase64(url);
                    imgMap[url] = dataUrl;
                } catch (e) {
                    console.warn("图片转换失败:", url, e);
                    imgMap[url] = url;
                }
                done += 1;
                ui.setProgress(done, imgUrls.length, exportTarget === "markdown" ? "处理图片" : "下载图片");
            }
        } else if (imgMode === "file" && imgUrls.length > 0) {
            ui.setStatus("正在下载并保存图片到 Obsidian…", "#a855f7");
            const imgDir = settings.obsidian.imgDir || resolveObsidianPaths(ui.obsidianConfig || getStoredObsidianConfig()).imgDir;
            const topicImgDir = joinVaultPath(imgDir, topicId);
            let done = 0;

            for (const url of imgUrls) {
                try {
                    const urlObj = new URL(url);
                    let ext = urlObj.pathname.split(".").pop() || "png";
                    if (ext.length > 5 || !/^[a-z0-9]+$/i.test(ext)) ext = "png";
                    const filename = `${Date.now()}-${done}.${ext}`;
                    const fullPath = joinVaultPath(topicImgDir, filename);

                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const blob = await response.blob();

                    await writeImageToObsidian(fullPath, blob, settings);
                    imgMap[url] = fullPath;
                } catch (e) {
                    console.warn("图片保存失败:", url, e);
                    imgMap[url] = null;
                }
                done += 1;
                ui.setProgress(done, imgUrls.length, "保存图片");
            }
        }

        return imgMap;
    }

    async function buildMarkdownExportPayload(target, context) {
        const exportContext = context || await buildExportContext(target);
        const settings = buildTargetExportSettings(exportContext.settings, exportContext.target);
        const imgMap = await buildImageMapForExport(exportContext.selected, settings, {
            target: exportContext.target,
            topicId: exportContext.topicId,
        });

        ui.setStatus("正在生成 Markdown…", "#a855f7");
        const markdown = generateMarkdownDocument(
            exportContext.topic,
            exportContext.selected,
            settings,
            imgMap,
            exportContext.filterSummary
        );

        return {
            ...exportContext,
            settings,
            imgMap,
            markdown,
        };
    }

    function triggerBrowserDownload(url, filename) {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 0);
    }

    async function exportMarkdownDownload() {
        ui.init();
        ui.clearDownloadFallback();
        ui.setBusy(true);
        ui.setStatus("正在拉取帖子内容…", "#a855f7");
        ui.setProgress(0, 1, "准备中");

        try {
            const baseSettings = ui.getSettings();
            const context = await buildExportContext("markdown", baseSettings);
            const payload = await buildMarkdownExportPayload("markdown", context);

            ui.setStatus("正在准备浏览器下载…", "#a855f7");
            const blob = new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" });
            const downloadUrl = URL.createObjectURL(blob);
            ui.setDownloadFallback(downloadUrl, payload.filename);
            triggerBrowserDownload(downloadUrl, payload.filename);

            ui.setProgress(1, 1, "导出完成");
            const finalNotes = buildExportOutcomeNotes(payload.aiOutcome);
            const suffix = finalNotes.length ? `（${finalNotes.join("；")}）` : "";
            ui.setStatus(`✅ 已下载 Markdown: ${payload.filename}${suffix}`, "#6ee7b7");
        } catch (e) {
            console.error(e);
            ui.setStatus("导出失败：" + (e?.message || e), "#fecaca");
            alert("Markdown 导出失败：" + (e?.message || e));
        } finally {
            ui.setBusy(false);
        }
    }

    async function exportToObsidian() {
        ui.init();
        ui.clearDownloadFallback();
        ui.setBusy(true);
        ui.setStatus("正在拉取帖子内容…", "#a855f7");
        ui.setProgress(0, 1, "准备中");

        try {
            const baseSettings = ui.getSettings();
            if (!baseSettings.obsidian?.apiKey) {
                openObsidianSettingsPanel();
                ui.setStatus("⚠️ 请先配置 Obsidian 连接", "#facc15");
                return;
            }

            const context = await buildExportContext("obsidian", baseSettings);
            const targetPathResult = await resolveObsidianExportTargetPath(context.topic, context.settings);
            if (targetPathResult?.cancelled) {
                ui.setStatus("已取消导出", "#facc15");
                return;
            }

            const payload = await buildMarkdownExportPayload("obsidian", context);
            ui.setStatus("正在写入 Obsidian…", "#a855f7");
            const writeResult = await writeToObsidian(targetPathResult.fullPath, payload.markdown, payload.settings);

            ui.setProgress(1, 1, "导出完成");
            const finalNotes = buildExportOutcomeNotes(
                payload.aiOutcome,
                writeResult.fallbackUsed ? [`已自动切换到 ${writeResult.effectiveApiUrl}`] : []
            );
            const suffix = finalNotes.length ? `（${finalNotes.join("；")}）` : "";
            ui.setStatus(`✅ 已导出到 Obsidian: ${targetPathResult.fullPath}${suffix}`, "#6ee7b7");
            ui.scheduleObsidianOverviewRefresh();
        } catch (e) {
            console.error(e);
            ui.setStatus("导出失败：" + (e?.message || e), "#fecaca");
            alert("Obsidian 导出失败：" + (e?.message || e));
        } finally {
            ui.setBusy(false);
        }
    }

    // -----------------------
    // 入口
    // -----------------------
    let hasInitialized = false;

    function init() {
        if (hasInitialized) return;
        const topicId = getTopicId();
        if (!topicId) return;

        hasInitialized = true;
        ui.init();

        ui.btnMarkdown.addEventListener("click", exportMarkdownDownload);
        ui.btnObsidian.addEventListener("click", exportToObsidian);
        ui.btnTestConnection.addEventListener("click", testObsidianConnection);
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init, { once: true });
        window.addEventListener("load", init, { once: true });
    }
})();
