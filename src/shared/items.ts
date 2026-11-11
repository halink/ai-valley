/** Goods have explicit material and food roles; names are shared by rules and observation. */
export const goods={
 wood:{name:'木材',food:0,life:0},stone:{name:'石料',food:0,life:0},berry:{name:'浆果',food:12,life:4},seed:{name:'种子',food:0,life:0},turnip:{name:'根菜',food:20,life:14},meal:{name:'餐食',food:42,life:3},water:{name:'清水',food:0,life:0},
 grain:{name:'谷物',food:12,life:28},fruit:{name:'水果',food:18,life:7},fish:{name:'鲜鱼',food:16,life:2},egg:{name:'鸡蛋',food:14,life:7},milk:{name:'鲜奶',food:16,life:3},cheese:{name:'奶酪',food:30,life:14},bread:{name:'面包',food:32,life:7},preserve:{name:'罐藏食品',food:26,life:56},gameMeat:{name:'生猎肉',food:0,life:2},
 fodder:{name:'饲料',food:0,life:0},manure:{name:'畜粪',food:0,life:0},compost:{name:'堆肥',food:0,life:0},herb:{name:'药草',food:0,life:0},medicine:{name:'照护药剂',food:0,life:0},ore:{name:'铁矿石',food:0,life:0},coal:{name:'燃煤',food:0,life:0},bar:{name:'铁锭',food:0,life:0},plank:{name:'木板',food:0,life:0},fiber:{name:'纤维',food:0,life:0},cloth:{name:'布料',food:0,life:0},wool:{name:'羊毛',food:0,life:0},sapling:{name:'果树苗',food:0,life:0},
 chickCrate:{name:'鸡雏运输笼',food:0,life:0},goatCrate:{name:'山羊运输笼',food:0,life:0},sheepCrate:{name:'绵羊运输笼',food:0,life:0},duckCrate:{name:'家鸭运输笼',food:0,life:0},cowCrate:{name:'牛运输栏',food:0,life:0},axeKit:{name:'斧具',food:0,life:0},pickKit:{name:'镐具',food:0,life:0},rodKit:{name:'钓具',food:0,life:0},spearKit:{name:'猎矛',food:0,life:0},
 perch:{name:'鲜湖鲈',food:16,life:2},carp:{name:'鲜河鲤',food:16,life:2},catfish:{name:'鲜夜鲶',food:18,life:2},bream:{name:'鲜雨鲂',food:16,life:2},snapper:{name:'鲜海鲷',food:18,life:2},cod:{name:'鲜寒水鳕',food:18,life:3},crucian:{name:'鲜冬鲫',food:14,life:3},
 duckEgg:{name:'鸭蛋',food:16,life:7},driedFish:{name:'鱼干',food:26,life:14},
} as const;
export type GoodsKey=keyof typeof goods;
export const itemKeys=Object.keys(goods) as GoodsKey[];
export const itemLabels=Object.fromEntries(itemKeys.map(k=>[k,goods[k].name])) as Record<GoodsKey,string>;
