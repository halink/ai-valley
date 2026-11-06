type Experience = 'farming' | 'building' | 'care' | 'beginner';
export type Founder = [name:string, age:number, experience:Experience, disposition:string];
export type HouseholdKind = 'parents-child' | 'generations' | 'parent-siblings' | 'single' | 'partners' | 'parent-child' | 'siblings' | 'housemates';
interface FoundingHousehold { houseName:string; kind:HouseholdKind; people:Founder[]; }

function household(houseName:string, kind:HouseholdKind, ...people:Founder[]):FoundingHousehold {
  return {houseName,kind,people};
}

/** Biographies at settlement, not occupations or future actions. The first adult owns the house. */
export const foundingHouseholds:FoundingHousehold[] = [
  household('紫藤小院','parents-child',
    ['苏庭',42,'building','习惯先量好尺寸再动手'], ['徐澜',41,'farming','爱比较不同土壤里的收成'], ['苏葵',13,'beginner','能认出许多鸟叫声']),
  household('山雀居','parents-child',
    ['陶笛',40,'care','习惯问清旁人的意思再帮忙'], ['高砚',43,'building','喜欢给旧器物找新用处'], ['高禾',15,'beginner','喜欢和长辈争论怎样做得更好']),
  household('河柳堂','generations',
    ['葛慈',68,'farming','看树芽辨别节气'], ['葛岚',38,'care','谈事情时会听完再开口'], ['葛川',11,'beginner','喜欢蹲在河边看小鱼']),
  household('石竹舍','parent-siblings',
    ['莫靖',45,'care','善于把家里的日用物件分好类'], ['莫青',14,'beginner','在热闹的地方也能专心看书'], ['莫芮',10,'beginner','喜欢问种子为什么会发芽']),
  household('望山小筑','single',['姚峤',28,'building','愿意为了好木料走更远的路']),
  household('苔窗居','single',['阮颂',56,'care','喜欢在安静的地方听人说话']),
  household('金粟屋','single',['费棠',71,'farming','熟悉种子晒干后的手感']),
  household('梅梢屋','single',['靳微',22,'beginner','乐于向不同的人请教同一个问题']),
  household('双檐小院','partners',
    ['叶遥',32,'care','喜欢把做好的食物分给客人'], ['严霁',34,'farming','做决定前会把余粮算清楚']),
  household('栗木屋','siblings',
    ['秦果',27,'farming','爱收集成熟得早的作物'], ['秦杉',24,'building','喜欢研究老屋梁的接合处']),
  household('木棉居','housemates',
    ['白荻',30,'care','听解释时常要多问一句'], ['樊桥',33,'building','遇到麻烦喜欢当场试一试']),
  household('竹影堂','parent-child',
    ['方竹',61,'building','能从敲击声辨出木板空响'], ['方荫',34,'farming','喜欢把新学来的办法记下来']),
  household('灯花屋','parent-child',
    ['纪桐',36,'care','对答应过的事情总记得很牢'], ['纪豆',8,'beginner','最喜欢听新来的人介绍家乡']),
  household('沙洲舍','partners',
    ['盛筠',47,'farming','重视有来有往的合作'], ['于沙',48,'care','喜欢在屋檐下慢慢商量']),
  household('桑叶居','siblings',
    ['唐麦',29,'farming','习惯把种子分开储存'], ['唐穗',25,'care','擅长把复杂的事慢慢讲清楚']),
  household('藤筐小楼','housemates',
    ['白砾',39,'building','爱从河滩上挑不同纹路的石头'], ['柯圆',37,'farming','愿意试种以前没见过的作物']),
  household('榆影舍','parent-child',
    ['邵平',66,'care','会耐心等别人把话说完'], ['邵屿',40,'building','乐于画下自己走过的小路']),
  household('槐花屋','partners',
    ['黎露',26,'farming','更喜欢和人一起准备节庆餐食'], ['温衡',29,'building','会把损坏的小东西攒下来修']),
  household('青瓦院','housemates',
    ['毕榛',52,'building','很看重工具用完后归还原处'], ['祝蓝',35,'care','愿意陪新朋友走头一段路']),
  household('斜阳小屋','siblings',
    ['钟闻',55,'farming','喜欢凭草木的气味认地方'], ['钟岚',51,'building','往往愿意先试做一个小样']),
  household('麻绳居','parent-child',
    ['关荟',43,'farming','能从掌心掂出种子的大致份量'], ['关栗',16,'beginner','对陌生地方既好奇又谨慎']),
  household('雀屏舍','housemates',
    ['石箫',23,'beginner','喜欢记下别人唱过的曲子'], ['路遥',25,'building','常为了弄明白原理拆开旧物']),
  household('丁香宅','partners',
    ['闻莲',60,'care','喜欢在忙碌过后独自散步'], ['张澄',63,'building','做活时不喜欢被人催促']),
  household('禾场小院','siblings',
    ['申青',31,'care','在意别人有没有被认真听见'], ['申洲',28,'farming','特别留意雨后的田埂']),
  household('月桂屋','parent-child',
    ['常墨',58,'building','能从湿气判断木料该怎样存'], ['常梨',31,'care','下决定前喜欢权衡几种选择']),
  household('井栏居','housemates',
    ['曲溪',21,'farming','喜欢沿水路认识新的地方'], ['聂萌',20,'beginner','每次尝试新东西都会问问邻居']),
  household('晚星舍','partners',
    ['段苇',38,'farming','珍惜一个人整理田地的时间'], ['江朔',40,'care','喜欢从一顿家常饭开始交朋友']),
];
