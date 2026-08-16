// サメザリオ — マスターデータ。ロジックは持たない。
//
// lore = 調布の史実（図鑑の豆知識）。intro = 図鑑のキャラ紹介文で、こちらは全部ウソ。
// 事実と冗談を混ぜないよう、意図的に別のフィールドに分けている。
// ruby / rubyIntro / rubyLore 等はアクセシビリティ（ルビ表示）用のマークアップ。

export const SHARKS = [
  {
    id: 'cinema',
    name: '映画サメ',
    ruby: '<ruby>映画<rp>(</rp><rt>えいが</rt><rp>)</rp></ruby>サメ',
    en: 'CINEMA',
    tag: 'バランス',
    rubyTag: 'バランス',
    color: '#3f6fb5', accent: '#8fb6e8',
    motif: 'カチンコ・フィルム',
    rubyMotif: 'カチンコ・フィルム',
    intro:
      '調布の撮影所に住み着いた自称・映画監督。ハンチング帽もフィルムも拾いものだが返す気はない。' +
      'カメラを向けられると全力でキメ顔をするため、撮影がまったく進まない。',
    rubyIntro:
      '<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>の<ruby>撮影所<rp>(</rp><rt>さつえいじょ</rt><rp>)</rp></ruby>に<ruby>住<rp>(</rp><rt>す</rt><rp>)</rp></ruby>み<ruby>着<rp>(</rp><rt>つ</rt><rp>)</rp></ruby>いた<ruby>自称<rp>(</rp><rt>じしょう</rt><rp>)</rp></ruby>・<ruby>映画監督<rp>(</rp><rt>えいがかんとく</rt><rp>)</rp></ruby>。ハンチング<ruby>帽<rp>(</rp><rt>ぼう</rt><rp>)</rp></ruby>もフィルムも<ruby>拾<rp>(</rp><rt>ひろ</rt><rp>)</rp></ruby>いものだが<ruby>返<rp>(</rp><rt>かえ</rt><rp>)</rp></ruby>す<ruby>気<rp>(</rp><rt>き</rt><rp>)</rp></ruby>はない。' +
      'カメラを<ruby>向<rp>(</rp><rt>む</rt><rp>)</rp></ruby>けられると<ruby>全力<rp>(</rp><rt>ぜんりょく</rt><rp>)</rp></ruby>でキメ<ruby>顔<rp>(</rp><rt>がお</rt><rp>)</rp></ruby>をするため、<ruby>撮影<rp>(</rp><rt>さつえい</rt><rp>)</rp></ruby>がまったく<ruby>進<rp>(</rp><rt>すす</rt><rp>)</rp></ruby>まない。',
    speed: 1.0, turn: 1.0, growth: 1.0, boostCost: 1.0, boostPower: 1.0, aspect: 1.62,
    skill: {
      name: 'スポットライト',
      rubyName: 'スポットライト',
      key: 'E', cd: 12, dur: 4,
      desc: '前方に光を放ち、範囲内の敵サメを4秒間スローダウンさせる。',
      rubyDesc: '<ruby>前方<rp>(</rp><rt>ぜんぽう</rt><rp>)</rp></ruby>に<ruby>光<rp>(</rp><rt>ひかり</rt><rp>)</rp></ruby>を<ruby>放<rp>(</rp><rt>はな</rt><rp>)</rp></ruby>ち、<ruby>範囲内<rp>(</rp><rt>はんいない</rt><rp>)</rp></ruby>の<ruby>敵<rp>(</rp><rt>てき</rt><rp>)</rp></ruby>サメを4<ruby>秒間<rp>(</rp><rt>びょうかん</rt><rp>)</rp></ruby>スローダウンさせる。',
    },
    lore:
      '調布は日活調布撮影所や角川大映スタジオを擁する「映画のまち」。' +
      '戦後から現在まで数え切れないほどの作品がこの街で撮られてきた。',
    rubyLore:
      '<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>は<ruby>日活調布撮影所<rp>(</rp><rt>にっかつちょうふさつえいじょ</rt><rp>)</rp></ruby>や<ruby>角川大映<rp>(</rp><rt>かどかわだいえい</rt><rp>)</rp></ruby>スタジオを<ruby>擁<rp>(</rp><rt>よう</rt><rp>)</rp></ruby>する「<ruby>映画<rp>(</rp><rt>えいが</rt><rp>)</rp></ruby>のまち」。' +
      '<ruby>戦後<rp>(</rp><rt>せんご</rt><rp>)</rp></ruby>から<ruby>現在<rp>(</rp><rt>げんざい</rt><rp>)</rp></ruby>まで<ruby>数<rp>(</rp><rt>かぞ</rt><rp>)</rp></ruby>え<ruby>切<rp>(</rp><rt>き</rt><rp>)</rp></ruby>れないほどの<ruby>作品<rp>(</rp><rt>さくひん</rt><rp>)</rp></ruby>がこの<ruby>街<rp>(</rp><rt>まち</rt><rp>)</rp></ruby>で<ruby>撮<rp>(</rp><rt>と</rt><rp>)</rp></ruby>られてきた。',
  },
  {
    id: 'yokai',
    name: '妖怪サメ',
    ruby: '<ruby>妖怪<rp>(</rp><rt>ようかい</rt><rp>)</rp></ruby>サメ',
    en: 'YOKAI',
    tag: '小回り',
    rubyTag: '<ruby>小回<rp>(</rp><rt>こまわ</rt><rp>)</rp></ruby>り',
    color: '#7b5ea7', accent: '#c3a9e6',
    motif: '水木しげる・天神通り',
    rubyMotif: '<ruby>水木<rp>(</rp><rt>みずき</rt><rp>)</rp></ruby>しげる・<ruby>天神通<rp>(</rp><rt>てんじんどお</rt><rp>)</rp></ruby>り',
    intro:
      '壁でも味方でもすり抜ける、実在が怪しいサメ。本人は「妖怪だから」と胸を張るが、' +
      '単に泳ぎが下手なだけという説が根強い。天神通りでは像の隣に立って小遣いを稼いでいる。',
    rubyIntro:
      '<ruby>壁<rp>(</rp><rt>かべ</rt><rp>)</rp></ruby>でも<ruby>味方<rp>(</rp><rt>みかた</rt><rp>)</rp></ruby>でもすり<ruby>抜<rp>(</rp><rt>ぬ</rt><rp>)</rp></ruby>ける、<ruby>実在<rp>(</rp><rt>じつざい</rt><rp>)</rp></ruby>が<ruby>怪<rp>(</rp><rt>あや</rt><rp>)</rp></ruby>しいサメ。<ruby>本人<rp>(</rp><rt>ほんにん</rt><rp>)</rp></ruby>は「<ruby>妖怪<rp>(</rp><rt>ようかい</rt><rp>)</rp></ruby>だから」と<ruby>胸<rp>(</rp><rt>むね</rt><rp>)</rp></ruby>を<ruby>張<rp>(</rp><rt>は</rt><rp>)</rp></ruby>るが、' +
      '<ruby>単<rp>(</rp><rt>たん</rt><rp>)</rp></ruby>に<ruby>泳<rp>(</rp><rt>およ</rt><rp>)</rp></ruby>ぎが<ruby>下手<rp>(</rp><rt>へた</rt><rp>)</rp></ruby>なだけという<ruby>説<rp>(</rp><rt>せつ</rt><rp>)</rp></ruby>が<ruby>根強<rp>(</rp><rt>ねづよ</rt><rp>)</rp></ruby>い。<ruby>天神通<rp>(</rp><rt>てんじんどお</rt><rp>)</rp></ruby>りでは<ruby>像<rp>(</rp><rt>ぞう</rt><rp>)</rp></ruby>の<ruby>隣<rp>(</rp><rt>となり</rt><rp>)</rp></ruby>に<ruby>立<rp>(</rp><rt>た</rt><rp>)</rp></ruby>って<ruby>小遣<rp>(</rp><rt>こづか</rt><rp>)</rp></ruby>いを<ruby>稼<rp>(</rp><rt>かせ</rt><rp>)</rp></ruby>いでいる。',
    speed: 0.92, turn: 1.35, growth: 1.0, boostCost: 1.0, boostPower: 0.95, aspect: 1.90,
    skill: {
      name: 'すり抜け',
      rubyName: 'すり<ruby>抜<rp>(</rp><rt>ぬ</rt><rp>)</rp></ruby>け',
      key: 'E', cd: 16, dur: 3.5,
      desc: '3.5秒間、他のサメの胴体と外壁をすり抜ける。',
      rubyDesc: '3.5<ruby>秒間<rp>(</rp><rt>びょうかん</rt><rp>)</rp></ruby>、<ruby>他<rp>(</rp><rt>ほか</rt><rp>)</rp></ruby>のサメの<ruby>胴体<rp>(</rp><rt>どうたい</rt><rp>)</rp></ruby>と<ruby>外壁<rp>(</rp><rt>がいへき</rt><rp>)</rp></ruby>をすり<ruby>抜<rp>(</rp><rt>ぬ</rt><rp>)</rp></ruby>ける。',
    },
    lore:
      '『ゲゲゲの鬼太郎』の水木しげるは1959年から調布に暮らした。' +
      '布田天神社へ続く天神通り商店街には鬼太郎たちの像が並び、佐須町には鬼太郎ひろばがある。',
    rubyLore:
      '『ゲゲゲの<ruby>鬼太郎<rp>(</rp><rt>きたろう</rt><rp>)</rp></ruby>』の<ruby>水木<rp>(</rp><rt>みずき</rt><rp>)</rp></ruby>しげるは1959<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>から<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>に<ruby>暮<rp>(</rp><rt>く</rt><rp>)</rp></ruby>らした。' +
      '<ruby>布田天神社<rp>(</rp><rt>ふだてんじんしゃ</rt><rp>)</rp></ruby>へ<ruby>続<rp>(</rp><rt>つづ</rt><rp>)</rp></ruby>く<ruby>天神通<rp>(</rp><rt>てんじんどお</rt><rp>)</rp></ruby>り<ruby>商店街<rp>(</rp><rt>しょうてんがい</rt><rp>)</rp></ruby>には<ruby>鬼太郎<rp>(</rp><rt>きたろう</rt><rp>)</rp></ruby>たちの<ruby>像<rp>(</rp><rt>ぞう</rt><rp>)</rp></ruby>が<ruby>並<rp>(</rp><rt>なら</rt><rp>)</rp></ruby>び、<ruby>佐須町<rp>(</rp><rt>さずまち</rt><rp>)</rp></ruby>には<ruby>鬼太郎<rp>(</rp><rt>きたろう</rt><rp>)</rp></ruby>ひろばがある。',
  },
  {
    id: 'tamagawa',
    name: '多摩川サメ',
    ruby: '<ruby>多摩川<rp>(</rp><rt>たまがわ</rt><rp>)</rp></ruby>サメ',
    en: 'TAMAGAWA',
    tag: 'スピード',
    rubyTag: 'スピード',
    color: '#2f9e8f', accent: '#93e5d6',
    motif: '多摩川の清流',
    rubyMotif: '<ruby>多摩川<rp>(</rp><rt>たまがわ</rt><rp>)</rp></ruby>の<ruby>清流<rp>(</rp><rt>せいりゅう</rt><rp>)</rp></ruby>',
    intro:
      '流れに乗ることしか考えていない。速度は文句なしの一級品、そのかわり曲がれない。' +
      '花火大会では特等席を取るため三日前から河川敷に浮いており、毎年ひとに心配されている。',
    rubyIntro:
      '<ruby>流<rp>(</rp><rt>なが</rt><rp>)</rp></ruby>れに<ruby>乗<rp>(</rp><rt>の</rt><rp>)</rp></ruby>ることしか<ruby>考<rp>(</rp><rt>かんが</rt><rp>)</rp></ruby>えていない。<ruby>速度<rp>(</rp><rt>そくど</rt><rp>)</rp></ruby>は<ruby>文句<rp>(</rp><rt>もんく</rt><rp>)</rp></ruby>なしの<ruby>一級品<rp>(</rp><rt>いっきゅうひん</rt><rp>)</rp></ruby>、そのかわり<ruby>曲<rp>(</rp><rt>ま</rt><rp>)</rp></ruby>がれない。' +
      '<ruby>花火大会<rp>(</rp><rt>はなびたいかい</rt><rp>)</rp></ruby>では<ruby>特等席<rp>(</rp><rt>とくとうせき</rt><rp>)</rp></ruby>を<ruby>取<rp>(</rp><rt>と</rt><rp>)</rp></ruby>るため<ruby>三日前<rp>(</rp><rt>みっかまえ</rt><rp>)</rp></ruby>から<ruby>河川敷<rp>(</rp><rt>かせんじき</rt><rp>)</rp></ruby>に<ruby>浮<rp>(</rp><rt>う</rt><rp>)</rp></ruby>いており、<ruby>毎年<rp>(</rp><rt>まいとし</rt><rp>)</rp></ruby>ひとに<ruby>心配<rp>(</rp><rt>しんぱい</rt><rp>)</rp></ruby>されている。',
    speed: 1.18, turn: 0.92, growth: 0.92, boostCost: 1.15, boostPower: 1.05, aspect: 1.74,
    skill: {
      name: '急流ブースト',
      rubyName: '<ruby>急流<rp>(</rp><rt>きゅうりゅう</rt><rp>)</rp></ruby>ブースト',
      key: 'E', cd: 9, dur: 0.35,
      desc: '一瞬で前方へ直線ダッシュ。サイズを消費しない。',
      rubyDesc: '<ruby>一瞬<rp>(</rp><rt>いっしゅん</rt><rp>)</rp></ruby>で<ruby>前方<rp>(</rp><rt>ぜんぽう</rt><rp>)</rp></ruby>へ<ruby>直線<rp>(</rp><rt>ちょくせん</rt><rp>)</rp></ruby>ダッシュ。サイズを<ruby>消費<rp>(</rp><rt>しょうひ</rt><rp>)</rp></ruby>しない。',
    },
    lore:
      '多摩川は調布市の南の境。夏には調布市花火大会が河川敷を埋め、' +
      '古代にはこの流域で織られた布が「調（みつぎ）」として納められた——それが市名の由来とされる。',
    rubyLore:
      '<ruby>多摩川<rp>(</rp><rt>たまがわ</rt><rp>)</rp></ruby>は<ruby>調布市<rp>(</rp><rt>ちょうふし</rt><rp>)</rp></ruby>の<ruby>南<rp>(</rp><rt>みなみ</rt><rp>)</rp></ruby>の<ruby>境<rp>(</rp><rt>さかい</rt><rp>)</rp></ruby>。<ruby>夏<rp>(</rp><rt>なつ</rt><rp>)</rp></ruby>には<ruby>調布市花火大会<rp>(</rp><rt>ちょうふしはなびたいかい</rt><rp>)</rp></ruby>が<ruby>河川敷<rp>(</rp><rt>かせんじき</rt><rp>)</rp></ruby>を<ruby>埋<rp>(</rp><rt>う</rt><rp>)</rp></ruby>め、' +
      '<ruby>古代<rp>(</rp><rt>こだい</rt><rp>)</rp></ruby>にはこの<ruby>流域<rp>(</rp><rt>りゅういき</rt><rp>)</rp></ruby>で<ruby>織<rp>(</rp><rt>お</rt><rp>)</rp></ruby>られた<ruby>布<rp>(</rp><rt>ぬの</rt><rp>)</rp></ruby>が「<ruby>調<rp>(</rp><rt>みつぎ</rt><rp>)</rp></ruby>」として<ruby>納<rp>(</rp><rt>おさ</rt><rp>)</rp></ruby>められた——それが<ruby>市名<rp>(</rp><rt>しめい</rt><rp>)</rp></ruby>の<ruby>由来<rp>(</rp><rt>ゆらい</rt><rp>)</rp></ruby>とされる。',
  },
  {
    id: 'jindaiji',
    name: '深大寺サメ',
    ruby: '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>サメ',
    en: 'JINDAIJI',
    tag: '成長',
    rubyTag: '<ruby>成長<rp>(</rp><rt>せいちょう</rt><rp>)</rp></ruby>',
    color: '#3b5a9c', accent: '#9db6e0',
    motif: '深大寺そば・古刹',
    rubyMotif: '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>そば・<ruby>古刹<rp>(</rp><rt>こさつ</rt><rp>)</rp></ruby>',
    intro:
      '食べた分だけ確実に大きくなる、そばの申し子。門前の蕎麦屋を全店制覇したという噂に対し、' +
      '本人は「まだ三周目」と静かに首を振る。湧き水で締めた麺以外は麺と認めない面倒なサメ。',
    rubyIntro:
      '<ruby>食<rp>(</rp><rt>た</rt><rp>)</rp></ruby>べた<ruby>分<rp>(</rp><rt>ぶん</rt><rp>)</rp></ruby>だけ<ruby>確実<rp>(</rp><rt>かくじつ</rt><rp>)</rp></ruby>に<ruby>大<rp>(</rp><rt>おお</rt><rp>)</rp></ruby>きくなる、そばの<ruby>申<rp>(</rp><rt>もう</rt><rp>)</rp></ruby>し<ruby>子<rp>(</rp><rt>ご</rt><rp>)</rp></ruby>。<ruby>門前<rp>(</rp><rt>もんぜん</rt><rp>)</rp></ruby>の<ruby>蕎麦屋<rp>(</rp><rt>そばや</rt><rp>)</rp></ruby>を<ruby>全店制覇<rp>(</rp><rt>ぜんてんせいは</rt><rp>)</rp></ruby>したという<ruby>噂<rp>(</rp><rt>うわさ</rt><rp>)</rp></ruby>に<ruby>対<rp>(</rp><rt>たい</rt><rp>)</rp></ruby>し、' +
      '<ruby>本人<rp>(</rp><rt>ほんにん</rt><rp>)</rp></ruby>は「まだ<ruby>三周目<rp>(</rp><rt>さんしゅうめ</rt><rp>)</rp></ruby>」と<ruby>静<rp>(</rp><rt>しず</rt><rp>)</rp></ruby>かに<ruby>首<rp>(</rp><rt>くび</rt><rp>)</rp></ruby>を<ruby>振<rp>(</rp><rt>ふ</rt><rp>)</rp></ruby>る。<ruby>湧<rp>(</rp><rt>わ</rt><rp>)</rp></ruby>き<ruby>水<rp>(</rp><rt>みず</rt><rp>)</rp></ruby>で<ruby>締<rp>(</rp><rt>し</rt><rp>)</rp></ruby>めた<ruby>麺以外<rp>(</rp><rt>めんいがい</rt><rp>)</rp></ruby>は<ruby>麺<rp>(</rp><rt>めん</rt><rp>)</rp></ruby>と<ruby>認<rp>(</rp><rt>みとめ</rt><rp>)</rp></ruby>ない<ruby>面倒<rp>(</rp><rt>めんどう</rt><rp>)</rp></ruby>なサメ。',
    speed: 0.96, turn: 1.0, growth: 1.35, boostCost: 1.1, boostPower: 1.0, aspect: 1.60,
    skill: {
      name: 'そばガード',
      rubyName: 'そばガード',
      key: 'E', cd: 22, dur: 10,
      desc: '10秒間、他のサメへの激突を1回だけ無効化する。',
      rubyDesc: '10<ruby>秒間<rp>(</rp><rt>びょうかん</rt><rp>)</rp></ruby>、<ruby>他<rp>(</rp><rt>ほか</rt><rp>)</rp></ruby>のサメへの<ruby>激突<rp>(</rp><rt>げきとつ</rt><rp>)</rp></ruby>を1<ruby>回<rp>(</rp><rt>かい</rt><rp>)</rp></ruby>だけ<ruby>無効化<rp>(</rp><rt>むこうか</rt><rp>)</rp></ruby>する。',
    },
    lore:
      '深大寺は天平5年（733年）開創と伝わる古刹で、都内では浅草寺に次ぐ歴史をもつ。' +
      '米が育ちにくい土地と豊かな湧水がそば作りを育て、今も門前に蕎麦屋が軒を連ねる。',
    rubyLore:
      '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>は<ruby>天平<rp>(</rp><rt>てんぴょう</rt><rp>)</rp></ruby>5<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>（733<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>）<ruby>開創<rp>(</rp><rt>かいそう</rt><rp>)</rp></ruby>と<ruby>伝<rp>(</rp><rt>つた</rt><rp>)</rp></ruby>わる<ruby>古刹<rp>(</rp><rt>こさつ</rt><rp>)</rp></ruby>で、<ruby>都内<rp>(</rp><rt>とない</rt><rp>)</rp></ruby>では<ruby>浅草寺<rp>(</rp><rt>せんそうじ</rt><rp>)</rp></ruby>に<ruby>次<rp>(</rp><rt>つ</rt><rp>)</rp></ruby>ぐ<ruby>歴史<rp>(</rp><rt>れきし</rt><rp>)</rp></ruby>をもつ。' +
      '<ruby>米<rp>(</rp><rt>こめ</rt><rp>)</rp></ruby>が<ruby>育<rp>(</rp><rt>そだ</rt><rp>)</rp></ruby>ちにくい<ruby>土地<rp>(</rp><rt>とち</rt><rp>)</rp></ruby>と<ruby>豊<rp>(</rp><rt>ゆた</rt><rp>)</rp></ruby>かな<ruby>湧水<rp>(</rp><rt>ゆうすい</rt><rp>)</rp></ruby>がそば<ruby>作<rp>(</rp><rt>づく</rt><rp>)</rp></ruby>りを<ruby>育<rp>(</rp><rt>そだ</rt><rp>)</rp></ruby>て、<ruby>今<rp>(</rp><rt>いま</rt><rp>)</rp></ruby>も<ruby>門前<rp>(</rp><rt>もんぜん</rt><rp>)</rp></ruby>に<ruby>蕎麦屋<rp>(</rp><rt>そばや</rt><rp>)</rp></ruby>が<ruby>軒<rp>(</rp><rt>のき</rt><rp>)</rp></ruby>を<ruby>連<rp>(</rp><rt>つら</rt><rp>)</rp></ruby>ねる。',
  },
  {
    id: 'airport',
    name: '飛行機サメ',
    ruby: '<ruby>飛行機<rp>(</rp><rt>ひこうき</rt><rp>)</rp></ruby>サメ',
    en: 'AIRPORT',
    tag: 'ダッシュ',
    rubyTag: 'ダッシュ',
    color: '#c8813a', accent: '#f3c78f',
    motif: '調布飛行場',
    rubyMotif: '<ruby>調布飛行場<rp>(</rp><rt>ちょうふひこうじょう</rt><rp>)</rp></ruby>',
    intro:
      '今日も調布飛行場から飛び立とうとして失敗しているサメ。エンジンは本物、免許は未取得。' +
      'ダッシュだけは誰より速いので、本人は完全に飛べているつもりでいる。',
    rubyIntro:
      '<ruby>今日<rp>(</rp><rt>きょう</rt><rp>)</rp></ruby>も<ruby>調布飛行場<rp>(</rp><rt>ちょうふひこうじょう</rt><rp>)</rp></ruby>から<ruby>飛<rp>(</rp><rt>と</rt><rp>)</rp></ruby>び<ruby>立<rp>(</rp><rt>た</rt><rp>)</rp></ruby>とうとして<ruby>失敗<rp>(</rp><rt>しっぱい</rt><rp>)</rp></ruby>しているサメ。エンジンは<ruby>本物<rp>(</rp><rt>ほんもの</rt><rp>)</rp></ruby>、<ruby>免許<rp>(</rp><rt>めんきょ</rt><rp>)</rp></ruby>は<ruby>未取得<rp>(</rp><rt>みしゅとく</rt><rp>)</rp></ruby>。' +
      'ダッシュだけは<ruby>誰<rp>(</rp><rt>だれ</rt><rp>)</rp></ruby>より<ruby>速<rp>(</rp><rt>はや</rt><rp>)</rp></ruby>いので、<ruby>本人<rp>(</rp><rt>ほんにん</rt><rp>)</rp></ruby>は<ruby>完全<rp>(</rp><rt>かんぜん</rt><rp>)</rp></ruby>に<ruby>飛<rp>(</rp><rt>と</rt><rp>)</rp></ruby>べているつもりでいる。',
    speed: 1.05, turn: 0.98, growth: 0.98, boostCost: 0.62, boostPower: 1.18, aspect: 1.83,
    skill: {
      name: '旋回飛行',
      rubyName: '<ruby>旋回飛行<rp>(</rp><rt>せんかいひこう</rt><rp>)</rp></ruby>',
      key: 'E', cd: 14, dur: 2.5,
      desc: '2.5秒間、周囲の餌を一気に吸い寄せる。',
      rubyDesc: '2.5<ruby>秒間<rp>(</rp><rt>びょうかん</rt><rp>)</rp></ruby>、<ruby>周囲<rp>(</rp><rt>しゅうい</rt><rp>)</rp></ruby>の<ruby>餌<rp>(</rp><rt>えさ</rt><rp>)</rp></ruby>を<ruby>一気<rp>(</rp><rt>いっき</rt><rp>)</rp></ruby>に<ruby>吸<rp>(</rp><rt>す</rt><rp>)</rp></ruby>い<ruby>寄<rp>(</rp><rt>よ</rt><rp>)</rp></ruby>せる。',
    },
    lore:
      '調布飛行場からは大島・新島・神津島・三宅島への定期便が飛ぶ。' +
      '戦時中は旧陸軍の飛行場で、掩体壕（えんたいごう）が今も武蔵野の森公園に残っている。',
    rubyLore:
      '<ruby>調布飛行場<rp>(</rp><rt>ちょうふひこうじょう</rt><rp>)</rp></ruby>からは<ruby>大島<rp>(</rp><rt>おおしま</rt><rp>)</rp></ruby>・<ruby>新島<rp>(</rp><rt>にいじま</rt><rp>)</rp></ruby>・<ruby>神津島<rp>(</rp><rt>こうづしま</rt><rp>)</rp></ruby>・<ruby>三宅島<rp>(</rp><rt>みやけじま</rt><rp>)</rp></ruby>への<ruby>定期便<rp>(</rp><rt>ていきびん</rt><rp>)</rp></ruby>が<ruby>飛<rp>(</rp><rt>と</rt><rp>)</rp></ruby>ぶ。' +
      '<ruby>戦時中<rp>(</rp><rt>せんじちゅう</rt><rp>)</rp></ruby>は<ruby>旧陸軍<rp>(</rp><rt>きゅうりくぐん</rt><rp>)</rp></ruby>の<ruby>飛行場<rp>(</rp><rt>ひこうじょう</rt><rp>)</rp></ruby>で、<ruby>掩体壕<rp>(</rp><rt>えんたいごう</rt><rp>)</rp></ruby>が<ruby>今<rp>(</rp><rt>いま</rt><rp>)</rp></ruby>も<ruby>武蔵野<rp>(</rp><rt>むさしの</rt><rp>)</rp></ruby>の<ruby>森公園<rp>(</rp><rt>もりこうえん</rt><rp>)</rp></ruby>に<ruby>残<rp>(</rp><rt>のこ</rt><rp>)</rp></ruby>っている。',
  },
];

// path — ロケ地選択画面のクリック領域であり、ゲーム中のプレイエリアの外周そのもの。
// viewBox は 0 0 1103 960 で、public/img/chofu_map.png（元の手描きエリア図。表示には使わず
// 原本として置いてある）を色ごとに輪郭抽出し、`scripts/seal-arms.mjs` で
// 細すぎる腕（サメが通れない幅の突起）を落としたもの。原本の path はそのスクリプト内にある。
// 描き直すときは元絵を差し替えて輪郭を取り直し、同じスクリプトを通す。
//
// size は「一辺」ではなく実効プレイ面積の平方根。ゲーム側が path の面積が size² になるよう
// 拡大するので、形を差し替えても遊べる広さは変わらない。label は名前を置く位置(%)。
export const MAPS = [
  {
    id: 'chofu',
    name: '調布駅・布田',
    ruby: '<ruby>調布駅<rp>(</rp><rt>ちょうふえき</rt><rp>)</rp></ruby>・<ruby>布田<rp>(</rp><rt>ふだ</rt><rp>)</rp></ruby>',
    kana: 'ちょうふえき・ふだ',
    en: 'CHOFU STATION',
    unlocked: true,
    label: { x: 48, y: 76 },
    path: 'M352 545l33 7,118 45,108 12,15 0,13 -7,15 2,22 29,9 28,40 15,0 18,-27 9,-33 81,-8 81,-13 61,-16 3,-42 -18,-107 -2,-11 -7,-20 -37,-157 -50,-1 -14,22 -76,-22 -20,-2 -13,53 -136,9 -9z',
    color: '#c0544c',
    size: 4200,
    water: '#2a7b7c',
    blurb: '駅前ロータリーとスクランブル交差点。映画フィルムが渦を巻く、すべての始まりの海。',
    rubyBlurb: '<ruby>駅前<rp>(</rp><rt>えきまえ</rt><rp>)</rp></ruby>ロータリーとスクランブル<ruby>交差点<rp>(</rp><rt>こうさてん</rt><rp>)</rp></ruby>。<ruby>映画<rp>(</rp><rt>えいが</rt><rp>)</rp></ruby>フィルムが<ruby>渦<rp>(</rp><rt>うず</rt><rp>)</rp></ruby>を<ruby>巻<rp>(</rp><rt>ま</rt><rp>)</rp></ruby>く、すべての<ruby>始<rp>(</rp><rt>はじ</rt><rp>)</rp></ruby>まりの<ruby>海<rp>(</rp><rt>うみ</rt><rp>)</rp></ruby>。',
    lore:
      '調布駅は2012年に地下化され、地上には広場と商業施設が生まれた。' +
      '駅前から北へ延びる天神通り商店街は、鬼太郎たちが出迎える参道でもある。',
    rubyLore:
      '<ruby>調布駅<rp>(</rp><rt>ちょうふえき</rt><rp>)</rp></ruby>は2012<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>に<ruby>地下化<rp>(</rp><rt>ちかか</rt><rp>)</rp></ruby>され、<ruby>地上<rp>(</rp><rt>ちじょう</rt><rp>)</rp></ruby>には<ruby>広場<rp>(</rp><rt>ひろば</rt><rp>)</rp></ruby>と<ruby>商業施設<rp>(</rp><rt>しょうぎょうしせつ</rt><rp>)</rp></ruby>が<ruby>生<rp>(</rp><rt>う</rt><rp>)</rp></ruby>まれた。' +
      '<ruby>駅前<rp>(</rp><rt>えきまえ</rt><rp>)</rp></ruby>から<ruby>北<rp>(</rp><rt>きた</rt><rp>)</rp></ruby>へ<ruby>延<rp>(</rp><rt>の</rt><rp>)</rp></ruby>びる<ruby>天神通<rp>(</rp><rt>てんじんどお</rt><rp>)</rp></ruby>り<ruby>商店街<rp>(</rp><rt>しょうてんがい</rt><rp>)</rp></ruby>は、<ruby>鬼太郎<rp>(</rp><rt>きたろう</rt><rp>)</rp></ruby>たちが出<ruby>迎<rp>(</rp><rt>むか</rt><rp>)</rp></ruby>える<ruby>参道<rp>(</rp><rt>さんどう</rt><rp>)</rp></ruby>でもある。',
  },
  {
    id: 'jindaiji',
    name: '深大寺',
    ruby: '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>',
    kana: 'じんだいじ',
    en: 'JINDAIJI',
    unlocked: false,
    label: { x: 49, y: 42 },
    path: 'M620 117l15 3,31 122,15 64,15 129,7 11,-5 33,-50 118,-26 11,-116 -10,-101 -35,-14 -9,-4 -7,0 -18,9 -17,2 -22,-4 -83,13 -24,-26 -24,-7 -27,0 -28,20 -141,17 -4,9 -18,20 -8,50 17,13 0,116 -31z',
    color: '#6c88ad',
    size: 4600,
    water: '#26696f',
    blurb: '湧水と参道。そば猪口とだるまが流れる、深い緑の水底。',
    rubyBlurb: '<ruby>湧水<rp>(</rp><rt>ゆうすい</rt><rp>)</rp></ruby>と<ruby>参道<rp>(</rp><rt>さんどう</rt><rp>)</rp></ruby>。そば<ruby>猪口<rp>(</rp><rt>ちょく</rt><rp>)</rp></ruby>とだるまが<ruby>流<rp>(</rp><rt>なが</rt><rp>)</rp></ruby>れる、<ruby>深<rp>(</rp><rt>ふか</rt><rp>)</rp></ruby>い<ruby>緑<rp>(</rp><rt>みどり</rt><rp>)</rp></ruby>の<ruby>水底<rp>(</rp><rt>みなそこ</rt><rp>)</rp></ruby>。',
    lore:
      '深大寺は天平5年（733年）開創。門前には湧水を活かした蕎麦屋が並び、' +
      '隣接する都立神代植物公園のバラ園は日本有数の規模を誇る。',
    rubyLore:
      '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>は<ruby>天平<rp>(</rp><rt>てんぴょう</rt><rp>)</rp></ruby>5<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>（733<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>）<ruby>開創<rp>(</rp><rt>かいそう</rt><rp>)</rp></ruby>。<ruby>門前<rp>(</rp><rt>もんぜん</rt><rp>)</rp></ruby>には<ruby>湧水<rp>(</rp><rt>ゆうすい</rt><rp>)</rp></ruby>を<ruby>活<rp>(</rp><rt>い</rt><rp>)</rp></ruby>かした<ruby>蕎麦屋<rp>(</rp><rt>そばや</rt><rp>)</rp></ruby>が<ruby>並<rp>(</rp><rt>なら</rt><rp>)</rp></ruby>び、' +
      '<ruby>隣接<rp>(</rp><rt>りんせつ</rt><rp>)</rp></ruby>する<ruby>都立神代植物公園<rp>(</rp><rt>とりつじんだいしょくぶつこうえん</rt><rp>)</rp></ruby>のバラ<ruby>園<rp>(</rp><rt>えん</rt><rp>)</rp></ruby>は<ruby>日本有数<rp>(</rp><rt>にほんゆうすう</rt><rp>)</rp></ruby>の<ruby>規模<rp>(</rp><rt>きぼ</rt><rp>)</rp></ruby>を<ruby>誇<rp>(</rp><rt>ほこ</rt><rp>)</rp></ruby>る。',
  },
  {
    id: 'tamagawa',
    name: '多摩川',
    ruby: '<ruby>多摩川<rp>(</rp><rt>たまがわ</rt><rp>)</rp></ruby>',
    kana: 'たまがわ',
    en: 'TAMAGAWA',
    unlocked: false,
    label: { x: 84, y: 59 },
    path: 'M872 282l9 2,10 9,9 24,46 -11,20 2,35 31,13 28,2 24,-41 35,8 18,20 5,7 10,2 70,13 33,4 3,18 0,5 15,6 42,-4 8,-11 3,0 85,-31 16,-9 -1,-26 -21,-22 10,-22 -23,-2 -20,-11 4,-4 13,-20 0,-20 -8,-7 -14,-22 -8,-15 -18,-20 -7,-70 31,-22 4,-39 -17,-9 -29,-22 -30,0 -18,9 -9,44 -112,-5 -23,3 -14,37 3,33 -9,15 2,31 37,-2 22,22 7,6 -3,7 -32,54 -42,-34 -17,-5 -20,9 -14,-4 -6,-14 0,-4 -7,2 -21,15 -7,-6 -26,7 -7z',
    color: '#4e8a5f',
    size: 5000,
    water: '#2f7f86',
    blurb: '広い河川敷と速い流れ。マップ最大、そして最速。',
    rubyBlurb: '<ruby>広<rp>(</rp><rt>ひろ</rt><rp>)</rp></ruby>い<ruby>河川敷<rp>(</rp><rt>かせんじき</rt><rp>)</rp></ruby>と<ruby>速<rp>(</rp><rt>はや</rt><rp>)</rp></ruby>い<ruby>流<rp>(</rp><rt>なが</rt><rp>)</rp></ruby>れ。マップ<ruby>最大<rp>(</rp><rt>さいだい</rt><rp>)</rp></ruby>、そして<ruby>最速<rp>(</rp><rt>さいそく</rt><rp>)</rp></ruby>。',
    lore:
      '多摩川の河川敷は調布市花火大会の舞台。市名「調布」は、' +
      'この流域で織られた布を朝廷へ「調」として納めたことに由来すると伝わる。',
    rubyLore:
      '<ruby>多摩川<rp>(</rp><rt>たまがわ</rt><rp>)</rp></ruby>の<ruby>河川敷<rp>(</rp><rt>かせんじき</rt><rp>)</rp></ruby>は<ruby>調布市花火大会<rp>(</rp><rt>ちょうふしはなびたいかい</rt><rp>)</rp></ruby>の<ruby>舞台<rp>(</rp><rt>ぶたい</rt><rp>)</rp></ruby>。<ruby>市名<rp>(</rp><rt>しめい</rt><rp>)</rp></ruby>「<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>」は、' +
      'この<ruby>流域<rp>(</rp><rt>りゅういき</rt><rp>)</rp></ruby>で<ruby>織<rp>(</rp><rt>お</rt><rp>)</rp></ruby>られた<ruby>布<rp>(</rp><rt>ぬの</rt><rp>)</rp></ruby>を<ruby>朝廷<rp>(</rp><rt>ちょうてい</rt><rp>)</rp></ruby>へ「<ruby>調<rp>(</rp><rt>みつぎ</rt><rp>)</rp></ruby>」として<ruby>納<rp>(</rp><rt>おさ</rt><rp>)</rp></ruby>めたことに<ruby>由来<rp>(</rp><rt>ゆらい</rt><rp>)</rp></ruby>すると<ruby>伝<rp>(</rp><rt>つた</rt><rp>)</rp></ruby>わる。',
  },
  {
    id: 'airport',
    name: '調布飛行場',
    ruby: '<ruby>調布飛行場<rp>(</rp><rt>ちょうふひこうじょう</rt><rp>)</rp></ruby>',
    kana: 'ちょうふひこうじょう',
    en: 'AIRFIELD',
    unlocked: false,
    label: { x: 20, y: 52 },
    path: 'M205 238l15 4,2 44,11 5,1 21,19 12,2 15,-8 15,2 5,24 8,9 -26,20 0,28 22,-2 35,13 2,6 13,38 2,9 9,4 81,-13 42,-15 4,-22 -6,-60 151,0 5,24 26,0 13,-21 64,-14 4,-43 -26,-69 -11,-15 -11,-52 -59,-3 -108,-24 -28,-15 -2,-5 -9,5 -24,72 -167,13 -4,5 -16,15 -8,9 -40,-5 -22,1 -18,8 -4,20 4,4 -13,5 -2z',
    color: '#d8a72c',
    size: 4400,
    water: '#2b7280',
    blurb: '滑走路と武蔵野の森。プロペラの風が餌を巻き上げる。',
    rubyBlurb: '<ruby>滑走路<rp>(</rp><rt>かっそうろ</rt><rp>)</rp></ruby>と<ruby>武蔵野<rp>(</rp><rt>むさしの</rt><rp>)</rp></ruby>の<ruby>森<rp>(</rp><rt>もり</rt><rp>)</rp></ruby>。プロペラの<ruby>風<rp>(</rp><rt>かぜ</rt><rp>)</rp></ruby>が<ruby>餌<rp>(</rp><rt>えさ</rt><rp>)</rp></ruby>を<ruby>巻<rp>(</rp><rt>ま</rt><rp>)</rp></ruby>き<ruby>上<rp>(</rp><rt>あ</rt><rp>)</rp></ruby>げる。',
    lore:
      '調布飛行場は伊豆諸島への空の玄関口。旧陸軍調布飛行場の掩体壕が' +
      '武蔵野の森公園に保存され、隣には味の素スタジアムが建つ。',
    rubyLore:
      '<ruby>調布飛行場<rp>(</rp><rt>ちょうふひこうじょう</rt><rp>)</rp></ruby>は<ruby>伊豆諸島<rp>(</rp><rt>いずしょとう</rt><rp>)</rp></ruby>への<ruby>空<rp>(</rp><rt>そら</rt><rp>)</rp></ruby>の<ruby>玄関口<rp>(</rp><rt>げんかんぐち</rt><rp>)</rp></ruby>。<ruby>旧陸軍調布飛行場<rp>(</rp><rt>きゅうりくぐんちょうふひこうじょう</rt><rp>)</rp></ruby>の<ruby>掩体壕<rp>(</rp><rt>えんたいごう</rt><rp>)</rp></ruby>が' +
      '<ruby>武蔵野<rp>(</rp><rt>むさしの</rt><rp>)</rp></ruby>の<ruby>森公園<rp>(</rp><rt>もりこうえん</rt><rp>)</rp></ruby>に<ruby>保存<rp>(</rp><rt>ほぞん</rt><rp>)</rp></ruby>され、<ruby>隣<rp>(</rp><rt>となり</rt><rp>)</rp></ruby>には<ruby>味<rp>(</rp><rt>あじ</rt><rp>)</rp></ruby>の<ruby>素<rp>(</rp><rt>もと</rt><rp>)</rp></ruby>スタジアムが<ruby>建<rp>(</rp><rt>た</rt><rp>)</rp></ruby>つ。',
  },
];

export const TIPS = [
  '<ruby>調布市<rp>(</rp><rt>ちょうふし</rt><rp>)</rp></ruby>は「<ruby>映画<rp>(</rp><rt>えいが</rt><rp>)</rp></ruby>のまち」。<ruby>日活調布撮影所<rp>(</rp><rt>にっかつちょうふさつえいじょ</rt><rp>)</rp></ruby>と<ruby>角川大映<rp>(</rp><rt>かどかわだいえい</rt><rp>)</rp></ruby>スタジオを<ruby>中心<rp>(</rp><rt>ちゅうしん</rt><rp>)</rp></ruby>に、<ruby>日本映画<rp>(</rp><rt>にほんえいが</rt><rp>)</rp></ruby>の<ruby>一大拠点<rp>(</rp><rt>いちだいきょてん</rt><rp>)</rp></ruby>になった。',
  '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>は<ruby>天平<rp>(</rp><rt>てんぴょう</rt><rp>)</rp></ruby>5<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>（733<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>）<ruby>開創<rp>(</rp><rt>かいそう</rt><rp>)</rp></ruby>と<ruby>伝<rp>(</rp><rt>つた</rt><rp>)</rp></ruby>わり、<ruby>都内<rp>(</rp><rt>とない</rt><rp>)</rp></ruby>では<ruby>浅草寺<rp>(</rp><rt>せんそうじ</rt><rp>)</rp></ruby>に<ruby>次<rp>(</rp><rt>つ</rt><rp>)</rp></ruby>ぐ<ruby>古刹<rp>(</rp><rt>こさつ</rt><rp>)</rp></ruby>とされる。',
  '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>そばは、<ruby>米<rp>(</rp><rt>こめ</rt><rp>)</rp></ruby>が<ruby>育<rp>(</rp><rt>そだ</rt><rp>)</rp></ruby>ちにくい<ruby>土壌<rp>(</rp><rt>どじょう</rt><rp>)</rp></ruby>と<ruby>豊富<rp>(</rp><rt>ほうふ</rt><rp>)</rp></ruby>な<ruby>湧水<rp>(</rp><rt>ゆうすい</rt><rp>)</rp></ruby>が<ruby>生<rp>(</rp><rt>う</rt><rp>)</rp></ruby>んだ<ruby>名物<rp>(</rp><rt>めいぶつ</rt><rp>)</rp></ruby>。<ruby>門前<rp>(</rp><rt>もんぜん</rt><rp>)</rp></ruby>には<ruby>今<rp>(</rp><rt>いま</rt><rp>)</rp></ruby>も<ruby>蕎麦屋<rp>(</rp><rt>そばや</rt><rp>)</rp></ruby>が<ruby>軒<rp>(</rp><rt>のき</rt><rp>)</rp></ruby>を<ruby>連<rp>(</rp><rt>つら</rt><rp>)</rp></ruby>ねる。',
  '『ゲゲゲの<ruby>鬼太郎<rp>(</rp><rt>きたろう</rt><rp>)</rp></ruby>』の<ruby>水木<rp>(</rp><rt>みずき</rt><rp>)</rp></ruby>しげるは1959<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>から<ruby>半世紀以上<rp>(</rp><rt>はんせいきいじょう</rt><rp>)</rp></ruby>を<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>で<ruby>過<rp>(</rp><rt>す</rt><rp>)</rp></ruby>ごした。',
  '<ruby>天神通<rp>(</rp><rt>てんじんどお</rt><rp>)</rp></ruby>り<ruby>商店街<rp>(</rp><rt>しょうてんがい</rt><rp>)</rp></ruby>には<ruby>鬼太郎<rp>(</rp><rt>きたろう</rt><rp>)</rp></ruby>・ねずみ<ruby>男<rp>(</rp><rt>おとこ</rt><rp>)</rp></ruby>・<ruby>目玉<rp>(</rp><rt>めだま</rt><rp>)</rp></ruby>おやじの<ruby>像<rp>(</rp><rt>ぞう</rt><rp>)</rp></ruby>が<ruby>立<rp>(</rp><rt>た</rt><rp>)</rp></ruby>っている。',
  '<ruby>調布飛行場<rp>(</rp><rt>ちょうふひこうじょう</rt><rp>)</rp></ruby>からは<ruby>大島<rp>(</rp><rt>おおしま</rt><rp>)</rp></ruby>・<ruby>新島<rp>(</rp><rt>にいじま</rt><rp>)</rp></ruby>・<ruby>神津島<rp>(</rp><rt>こうづしま</rt><rp>)</rp></ruby>・<ruby>三宅島<rp>(</rp><rt>みやけじま</rt><rp>)</rp></ruby>への<ruby>定期便<rp>(</rp><rt>ていきびん</rt><rp>)</rp></ruby>が<ruby>就航<rp>(</rp><rt>しゅうこう</rt><rp>)</rp></ruby>している。',
  '<ruby>味<rp>(</rp><rt>あじ</rt><rp>)</rp></ruby>の<ruby>素<rp>(</rp><rt>もと</rt><rp>)</rp></ruby>スタジアム（<ruby>東京<rp>(</rp><rt>とうきょう</rt><rp>)</rp></ruby>スタジアム）はFC<ruby>東京<rp>(</rp><rt>とうきょう</rt><rp>)</rp></ruby>と<ruby>東京<rp>(</rp><rt>とうきょう</rt><rp>)</rp></ruby>ヴェルディの<ruby>本拠地<rp>(</rp><rt>ほんきょち</rt><rp>)</rp></ruby>。',
  '<ruby>都立神代植物公園<rp>(</rp><rt>とりつじんだいしょくぶつこうえん</rt><rp>)</rp></ruby>のバラ<ruby>園<rp>(</rp><rt>えん</rt><rp>)</rp></ruby>は<ruby>約<rp>(</rp><rt>やく</rt><rp>)</rp></ruby>400<ruby>品種<rp>(</rp><rt>ひんしゅ</rt><rp>)</rp></ruby>・5000<ruby>株<rp>(</rp><rt>かぶ</rt><rp>)</rp></ruby>。<ruby>春<rp>(</rp><rt>はる</rt><rp>)</rp></ruby>と<ruby>秋<rp>(</rp><rt>あき</rt><rp>)</rp></ruby>にフェスタが<ruby>開<rp>(</rp><rt>ひら</rt><rp>)</rp></ruby>かれる。',
  '<ruby>布田天神社<rp>(</rp><rt>ふだてんじんしゃ</rt><rp>)</rp></ruby>は<ruby>菅原道真<rp>(</rp><rt>すがわらのみちざね</rt><rp>)</rp></ruby>を<ruby>祀<rp>(</rp><rt>まつ</rt><rp>)</rp></ruby>る<ruby>古社<rp>(</rp><rt>こしゃ</rt><rp>)</rp></ruby>。<ruby>毎月<rp>(</rp><rt>まいつき</rt><rp>)</rp></ruby>25<ruby>日<rp>(</rp><rt>にち</rt><rp>)</rp></ruby>には<ruby>天神市<rp>(</rp><rt>てんじんいち</rt><rp>)</rp></ruby>が<ruby>立<rp>(</rp><rt>た</rt><rp>)</rp></ruby>つ。',
  '「<ruby>調布<rp>(</rp><rt>ちょうふ</rt><rp>)</rp></ruby>」の<ruby>名<rp>(</rp><rt>な</rt><rp>)</rp></ruby>は、<ruby>多摩川流域<rp>(</rp><rt>たまがわりゅういき</rt><rp>)</rp></ruby>で<ruby>織<rp>(</rp><rt>お</rt><rp>)</rp></ruby>った<ruby>布<rp>(</rp><rt>ぬの</rt><rp>)</rp></ruby>を<ruby>朝廷<rp>(</rp><rt>ちょうてい</rt><rp>)</rp></ruby>に「<ruby>調<rp>(</rp><rt>みつぎ</rt><rp>)</rp></ruby>」として<ruby>納<rp>(</rp><rt>おさ</rt><rp>)</rp></ruby>めたことに<ruby>由来<rp>(</rp><rt>ゆらい</rt><rp>)</rp></ruby>すると<ruby>伝<rp>(</rp><rt>つた</rt><rp>)</rp></ruby>わる。',
  '<ruby>調布駅<rp>(</rp><rt>ちょうふえき</rt><rp>)</rp></ruby>は2012<ruby>年<rp>(</rp><rt>ねん</rt><rp>)</rp></ruby>に<ruby>地下化<rp>(</rp><rt>ちかか</rt><rp>)</rp></ruby>。<ruby>地上<rp>(</rp><rt>ちじょう</rt><rp>)</rp></ruby>の<ruby>踏切<rp>(</rp><rt>ふみきり</rt><rp>)</rp></ruby>がなくなり、<ruby>街<rp>(</rp><rt>まち</rt><rp>)</rp></ruby>の<ruby>南北<rp>(</rp><rt>なんぼく</rt><rp>)</rp></ruby>がつながった。',
  '<ruby>武蔵野<rp>(</rp><rt>むさしの</rt><rp>)</rp></ruby>の<ruby>森公園<rp>(</rp><rt>もりこうえん</rt><rp>)</rp></ruby>には、<ruby>旧陸軍調布飛行場<rp>(</rp><rt>きゅうりくぐんちょうふひこうじょう</rt><rp>)</rp></ruby>の<ruby>掩体壕<rp>(</rp><rt>えんたいごう</rt><rp>)</rp></ruby>（<ruby>戦闘機<rp>(</rp><rt>せんとうき</rt><rp>)</rp></ruby>を<ruby>守<rp>(</rp><rt>まも</rt><rp>)</rp></ruby>る<ruby>格納庫<rp>(</rp><rt>かくのうこ</rt><rp>)</rp></ruby>）が<ruby>保存<rp>(</rp><rt>ほぞん</rt><rp>)</rp></ruby>されている。',
  '<ruby>調布市花火大会<rp>(</rp><rt>ちょうふしはなびたいかい</rt><rp>)</rp></ruby>は<ruby>多摩川<rp>(</rp><rt>たまがわ</rt><rp>)</rp></ruby>の<ruby>河川敷<rp>(</rp><rt>かせんじき</rt><rp>)</rp></ruby>が<ruby>舞台<rp>(</rp><rt>ぶたい</rt><rp>)</rp></ruby>。<ruby>夏<rp>(</rp><rt>なつ</rt><rp>)</rp></ruby>の<ruby>風物詩<rp>(</rp><rt>ふうぶつし</rt><rp>)</rp></ruby>として<ruby>親<rp>(</rp><rt>した</rt><rp>)</rp></ruby>しまれている。',
  '<ruby>深大寺<rp>(</rp><rt>じんだいじ</rt><rp>)</rp></ruby>の「<ruby>白鳳仏<rp>(</rp><rt>はくほうぶつ</rt><rp>)</rp></ruby>」は<ruby>国宝<rp>(</rp><rt>こくほう</rt><rp>)</rp></ruby>の<ruby>釈迦如来倚像<rp>(</rp><rt>しゃかにょらいいぞう</rt><rp>)</rp></ruby>。<ruby>飛鳥時代後期<rp>(</rp><rt>あすかじだいこうき</rt><rp>)</rp></ruby>の<ruby>作<rp>(</rp><rt>さく</rt><rp>)</rp></ruby>とされる。',
];

export const BOT_NAMES = [
  'スピルバーグ鮫', 'FinFincher', '黒澤サメ', 'サメロン・クロウ', 'タランティー鮫',
  'ヒッチ鮫ック', 'ゴダー鮫', 'サメ・バートン', 'コッポ鮫', '小津サメ二郎',
  'サメロン', 'ノーラン鮫', 'リドリー鮫', '是枝サメ', '宮崎サメ',
];
