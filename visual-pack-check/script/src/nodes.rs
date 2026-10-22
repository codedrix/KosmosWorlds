//! Every node the script finds, and the page each one belongs to.
//!
//! @kosmos-system  Content (KosmosWorlds) -- Visual Pack Check
//! @kosmos-owner   KOS-699 (builder vp-w1)
//!
//! ../tools/build_glb.mjs reads `NAMED` and `GROUPS` from this file and builds
//! exactly these meshes (its node contract fails the build otherwise). Names
//! never end in a digit: the client strips a trailing `_<digits>`, so grid
//! nodes are lettered (`CellAa` .. `CellHh`, `BarA` .. `BarL`).
//!
//! k_node_find sees only nodes with a mesh, so every name here is a mesh.

/// Page masks. A named node is shown on the pages in its mask (ROOM: never hidden).
pub const ROOM: u8 = 0;
pub const P_TEXT: u8 = 1;
pub const P_GRID: u8 = 2;
pub const P_COLOUR: u8 = 4;
pub const P_PICS: u8 = 8;
pub const P_HOVER: u8 = 16;
pub const P_TRAVEL: u8 = 32;
pub const P_MR: u8 = 64;
/// The tabs, the title and the two status plaques: every VR page but the 64-text grid
/// (which needs all 64 text slots for itself).
pub const CHROME: u8 = P_TEXT | P_COLOUR | P_PICS | P_HOVER | P_TRAVEL;

macro_rules! named {
    ($($id:ident = $name:literal : $mask:expr),* $(,)?) => {
        /// A named node's index into `NAMED`.
        #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum N { $($id),* }
        /// (name, page mask), in `N` order.
        pub const NAMED: &[(&str, u8)] = &[$(($name, $mask)),*];
    };
}

named! {
    // The room (VR).
    Floor = "Floor": ROOM,
    WallFront = "WallFront": ROOM,
    WallBack = "WallBack": ROOM,
    WallLeft = "WallLeft": ROOM,
    WallRight = "WallRight": ROOM,
    Board = "Board": ROOM,
    // The chrome.
    TabText = "TabText": CHROME,
    TabGrid = "TabGrid": CHROME,
    TabColour = "TabColour": CHROME,
    TabPics = "TabPics": CHROME,
    TabHover = "TabHover": CHROME,
    TabTravel = "TabTravel": CHROME,
    TxtTitle = "TxtTitle": CHROME,
    TxtStatus = "TxtStatus": CHROME,
    TxtStatusB = "TxtStatusB": CHROME,
    // K1: styled text. Studs on the board: Left / Mid / Right columns, Big (160 mm) / Small (10 mm), Strong / Reg.
    SampLeftBigStrong = "SampLeftBigStrong": P_TEXT,
    SampLeftBigReg = "SampLeftBigReg": P_TEXT,
    SampLeftSmallStrong = "SampLeftSmallStrong": P_TEXT,
    SampLeftSmallReg = "SampLeftSmallReg": P_TEXT,
    SampMidBigStrong = "SampMidBigStrong": P_TEXT,
    SampMidBigReg = "SampMidBigReg": P_TEXT,
    SampMidSmallStrong = "SampMidSmallStrong": P_TEXT,
    SampMidSmallReg = "SampMidSmallReg": P_TEXT,
    SampRightBigStrong = "SampRightBigStrong": P_TEXT,
    SampRightBigReg = "SampRightBigReg": P_TEXT,
    SampRightSmallStrong = "SampRightSmallStrong": P_TEXT,
    SampRightSmallReg = "SampRightSmallReg": P_TEXT,
    SampDefault = "SampDefault": P_TEXT,
    CapLeft = "CapLeft": P_TEXT,
    CapMid = "CapMid": P_TEXT,
    CapRight = "CapRight": P_TEXT,
    GuideLeft = "GuideLeft": P_TEXT,
    GuideMid = "GuideMid": P_TEXT,
    GuideRight = "GuideRight": P_TEXT,
    BtnPlate = "BtnPlate": P_TEXT,
    BtnBadValues = "BtnBadValues": P_TEXT,
    BtnOldCall = "BtnOldCall": P_TEXT,
    // K3: a plated text with a wall in front of half of it.
    SampBehind = "SampBehind": P_TEXT,
    OccWall = "OccWall": P_TEXT,
    // K2: the 64-text grid (its cells are the Cell group) and the deep-hierarchy hover tower (Deep group).
    GridBoard = "GridBoard": P_GRID,
    // K5, K6, K8: colour, glow, fade, reset, 256 instances, the clone.
    ColCube = "ColCube": P_COLOUR,
    ColBlend = "ColBlend": P_COLOUR,
    ColOpaque = "ColOpaque": P_COLOUR,
    ColUnlit = "ColUnlit": P_COLOUR,
    ColShareA = "ColShareA": P_COLOUR,
    ColShareB = "ColShareB": P_COLOUR,
    ColChip = "ColChip": P_COLOUR,
    ColChipSpot = "ColChipSpot": P_COLOUR,
    BtnColour = "BtnColour": P_COLOUR,
    BtnGlow = "BtnGlow": P_COLOUR,
    BtnResetCube = "BtnResetCube": P_COLOUR,
    BtnFade = "BtnFade": P_COLOUR,
    BtnTryEight = "BtnTryEight": P_COLOUR,
    BtnShareA = "BtnShareA": P_COLOUR,
    BtnClone = "BtnClone": P_COLOUR,
    BtnCloneColour = "BtnCloneColour": P_COLOUR,
    BtnMany = "BtnMany": P_COLOUR,
    BtnFrameCap = "BtnFrameCap": P_COLOUR,
    TileBoard = "TileBoard": P_COLOUR,
    // K7: pictures.
    PicA = "PicA": P_PICS,
    PicB = "PicB": P_PICS,
    PicC = "PicC": P_PICS,
    PicD = "PicD": P_PICS,
    PicE = "PicE": P_PICS,
    PicF = "PicF": P_PICS,
    PicNoUv = "PicNoUv": P_PICS,
    BtnPicShow = "BtnPicShow": P_PICS,
    BtnPicSwap = "BtnPicSwap": P_PICS,
    BtnPicTint = "BtnPicTint": P_PICS,
    BtnPicReset = "BtnPicReset": P_PICS,
    BtnPicMissing = "BtnPicMissing": P_PICS,
    BtnPicNoUv = "BtnPicNoUv": P_PICS,
    // K9: hover.
    HoverPad = "HoverPad": P_HOVER,
    HoverGo = "HoverGo": P_HOVER,
    HoverArch = "HoverArch": P_HOVER,
    HoverBehind = "HoverBehind": P_HOVER,
    BtnHoverClear = "BtnHoverClear": P_HOVER,
    TxtLog = "TxtLog": P_HOVER,
    // K11 and the cancelled-travel restore.
    TrvCube = "TrvCube": P_TRAVEL,
    TrvGlow = "TrvGlow": P_TRAVEL,
    TrvBlend = "TrvBlend": P_TRAVEL,
    TrvPic = "TrvPic": P_TRAVEL,
    BtnLooks = "BtnLooks": P_TRAVEL,
    BtnLooksOff = "BtnLooksOff": P_TRAVEL,
    DoorReal = "DoorReal": P_TRAVEL,
    DoorNowhere = "DoorNowhere": P_TRAVEL,
    // K4: the mixed-reality twin (world://visual-pack-check-mr.micknerks). Its scene has
    // only these and the VR scene has none of them; MrMarker tells the script which it is.
    MrMarker = "MrMarker": P_MR,
    MrTitle = "MrTitle": P_MR,
    MrStatus = "MrStatus": P_MR,
    MrTxtA = "MrTxtA": P_MR,
    MrTxtB = "MrTxtB": P_MR,
    MrTxtC = "MrTxtC": P_MR,
    MrTxtD = "MrTxtD": P_MR,
    MrTxtE = "MrTxtE": P_MR,
    MrTxtF = "MrTxtF": P_MR,
    MrFade = "MrFade": P_MR,
    MrSolid = "MrSolid": P_MR,
    MrBtnPlates = "MrBtnPlates": P_MR,
    MrBtnFade = "MrBtnFade": P_MR,
}

pub const NAMED_COUNT: usize = NAMED.len();

/// Lettered groups: (prefix, count, two letters (8 x 8) or one, page mask).
/// Two-letter names: prefix + row 'A'.. + column 'a'..; one-letter: prefix + 'A'...
pub const GROUPS: [(&str, usize, bool, u8); 5] = [
    ("Cell", 64, true, P_GRID),
    ("Deep", 16, false, P_GRID),
    ("Tile", 64, true, P_COLOUR),
    ("Bar", 12, false, P_HOVER),
    ("Rate", 20, false, P_HOVER),
];
pub const G_CELL: usize = 0;
pub const G_DEEP: usize = 1;
pub const G_TILE: usize = 2;
pub const G_BAR: usize = 3;
pub const G_RATE: usize = 4;
/// Material slots on each tile (four quarters, four authored materials): 64 x 4 = 256 instances.
pub const TILE_SLOTS: i32 = 4;

/// The name of member `i` of group `g`, written into `out`; returns its length.
pub fn group_name(g: usize, i: usize, out: &mut [u8; 16]) -> usize {
    let (prefix, _, two, _) = GROUPS[g];
    let p = prefix.as_bytes();
    out[..p.len()].copy_from_slice(p);
    if two {
        out[p.len()] = b'A' + (i / 8) as u8;
        out[p.len() + 1] = b'a' + (i % 8) as u8;
        p.len() + 2
    } else {
        out[p.len()] = b'A' + i as u8;
        p.len() + 1
    }
}
