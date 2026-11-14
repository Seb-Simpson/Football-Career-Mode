// Entirely fictional name pools. Combinations are generated, never real rosters.

export const NATIONS: { code: string; name: string; weight: number; first: string[]; last: string[] }[] = [
  {
    code: 'ALB',
    name: 'Albrenne',
    weight: 6,
    first: ['Tom', 'Callum', 'Owen', 'Rhys', 'Jack', 'Ethan', 'Lewis', 'Harvey', 'Kieran', 'Ross', 'Declan', 'Liam', 'Ben', 'Joe', 'Archie', 'Finn', 'Alfie', 'Max', 'Sam', 'Ryan', 'Jordan', 'Danny', 'Elliot', 'George', 'Reece', 'Mason', 'Connor', 'Jamie', 'Toby', 'Will'],
    last: ['Ashworth', 'Brannigan', 'Coldwell', 'Dunmore', 'Ellerby', 'Fairclough', 'Garside', 'Hartigan', 'Ingleby', 'Jessop', 'Kettering', 'Lightfoot', 'Marlow', 'Nettleton', 'Oakes', 'Pennock', 'Quarmby', 'Rudd', 'Stannard', 'Thursby', 'Upton', 'Varley', 'Whitlock', 'Yardley', 'Brindle', 'Cotterill', 'Hebden', 'Mossop', 'Pickles', 'Raistrick', 'Sowerby', 'Tattersall', 'Walmsley', 'Birtles', 'Crabtree', 'Gledhill'],
  },
  {
    code: 'VAL',
    name: 'Valdora',
    weight: 2,
    first: ['Mateo', 'Iker', 'Dario', 'Lucio', 'Andrés', 'Nico', 'Rafa', 'Tomás', 'Joel', 'Santi', 'Bruno', 'Íñigo'],
    last: ['Arrieta', 'Belmonte', 'Calvera', 'Durango', 'Escarra', 'Fontana', 'Galdós', 'Herrán', 'Iturbe', 'Lozada', 'Mendaro', 'Olazar', 'Pereda', 'Sarrión', 'Urquiza', 'Villaro'],
  },
  {
    code: 'NRS',
    name: 'Norrsund',
    weight: 1.5,
    first: ['Erik', 'Lasse', 'Oskar', 'Magnus', 'Viktor', 'Anders', 'Jonas', 'Emil', 'Henrik', 'Tobias'],
    last: ['Ahlgren', 'Berglind', 'Dahlqvist', 'Ekholt', 'Fjellström', 'Granlund', 'Hovland', 'Lindqvist', 'Nyberg', 'Ståhlberg', 'Vikander', 'Østby'],
  },
  {
    code: 'KEM',
    name: 'Kemara',
    weight: 1.5,
    first: ['Kofi', 'Yaw', 'Kwame', 'Ade', 'Tunde', 'Seydou', 'Ibou', 'Moussa', 'Chidi', 'Femi', 'Jomo', 'Baraka'],
    last: ['Asante', 'Boateng', 'Diallo', 'Eze', 'Kamara', 'Mensah', 'Nwosu', 'Okafor', 'Sarr', 'Traoré', 'Owusu', 'Adeyemi', 'Ndiaye', 'Achebe'],
  },
  {
    code: 'LUS',
    name: 'Lusora',
    weight: 1.2,
    first: ['João', 'Rui', 'Tiago', 'Duarte', 'Gonçalo', 'Vasco', 'Rafael', 'Diogo', 'Nuno', 'Caio'],
    last: ['Amaral', 'Barreto', 'Correia', 'Falcão', 'Guerreiro', 'Lacerda', 'Moreira', 'Pinheiro', 'Quintela', 'Sequeira', 'Teixeira', 'Valente'],
  },
  {
    code: 'BRV',
    name: 'Brevany',
    weight: 1,
    first: ['Luc', 'Théo', 'Hugo', 'Yanis', 'Bastien', 'Mathis', 'Rémi', 'Enzo', 'Gaël', 'Noé'],
    last: ['Aubertin', 'Brossard', 'Castagne', 'Delorme', 'Ferrand', 'Gaudin', 'Lemoine', 'Marchetti', 'Perrot', 'Rivière', 'Vasseur'],
  },
];

export const CLUB_DEFS: {
  town: string;
  suffix: string;
  short: string;
  nickname: string;
  primary: string;
  secondary: string;
  pattern: 'solid' | 'stripes' | 'hoops' | 'sash' | 'halves' | 'pinstripe';
  badge: 'shield' | 'round' | 'diamond' | 'crest';
  stadium: string;
  capacity: number;
  rep: number;
  founded: number;
}[] = [
  { town: 'Calderwick', suffix: 'United', short: 'CAL', nickname: 'The Millers', primary: '#C8102E', secondary: '#FFFFFF', pattern: 'solid', badge: 'shield', stadium: 'Mill Lane', capacity: 41000, rep: 84, founded: 1882 },
  { town: 'Port Elsby', suffix: 'Athletic', short: 'POR', nickname: 'The Dockers', primary: '#0B3D91', secondary: '#F2C230', pattern: 'stripes', badge: 'round', stadium: 'The Quayside', capacity: 36500, rep: 80, founded: 1889 },
  { town: 'Kingsmere', suffix: 'City', short: 'KIN', nickname: 'The Royals', primary: '#6CABDD', secondary: '#1C2C5B', pattern: 'solid', badge: 'crest', stadium: 'Regent Park', capacity: 38000, rep: 78, founded: 1894 },
  { town: 'Brackwater', suffix: 'Rovers', short: 'BRA', nickname: 'The Tide', primary: '#1E6B52', secondary: '#FFFFFF', pattern: 'hoops', badge: 'shield', stadium: 'Saltmarsh Road', capacity: 27000, rep: 72, founded: 1878 },
  { town: 'Westhollow', suffix: 'Town', short: 'WES', nickname: 'The Hollow', primary: '#F28C28', secondary: '#111A2E', pattern: 'solid', badge: 'diamond', stadium: 'Cinder Bank', capacity: 24000, rep: 68, founded: 1901 },
  { town: 'Stormhaven', suffix: 'FC', short: 'STO', nickname: 'The Gulls', primary: '#FFFFFF', secondary: '#0E2A47', pattern: 'sash', badge: 'round', stadium: 'Headland Ground', capacity: 22500, rep: 66, founded: 1887 },
  { town: 'Fenmouth', suffix: 'Albion', short: 'FEN', nickname: 'The Reeds', primary: '#7A1F3D', secondary: '#9FD3E6', pattern: 'halves', badge: 'crest', stadium: 'Dyke End', capacity: 21000, rep: 63, founded: 1885 },
  { town: 'Ashcombe', suffix: 'Wanderers', short: 'ASH', nickname: 'The Wands', primary: '#2B2B2B', secondary: '#E8E8E8', pattern: 'stripes', badge: 'shield', stadium: 'Copse Hill', capacity: 19500, rep: 60, founded: 1880 },
  { town: 'Redmarsh', suffix: 'County', short: 'RED', nickname: 'The Foxes', primary: '#B0302A', secondary: '#1B1B1B', pattern: 'pinstripe', badge: 'diamond', stadium: 'Station Fields', capacity: 18000, rep: 58, founded: 1898 },
  { town: 'Oldmoor', suffix: 'Borough', short: 'OLD', nickname: 'The Moorsmen', primary: '#5B2C83', secondary: '#FFFFFF', pattern: 'solid', badge: 'round', stadium: 'Heather Way', capacity: 16500, rep: 56, founded: 1906 },
  // Division two
  { town: 'Thornby', suffix: 'Rangers', short: 'THO', nickname: 'The Thorns', primary: '#00594F', secondary: '#E9C46A', pattern: 'hoops', badge: 'crest', stadium: 'Bramble Park', capacity: 17000, rep: 55, founded: 1892 },
  { town: 'Gullhaven', suffix: 'United', short: 'GUL', nickname: 'The Seasiders', primary: '#F4D03F', secondary: '#1A1A1A', pattern: 'solid', badge: 'shield', stadium: 'Promenade', capacity: 14500, rep: 52, founded: 1910 },
  { town: 'Marrowgate', suffix: 'FC', short: 'MAR', nickname: 'The Gate', primary: '#1D3557', secondary: '#E63946', pattern: 'sash', badge: 'diamond', stadium: 'Turnpike Road', capacity: 13000, rep: 50, founded: 1883 },
  { town: 'Hexley', suffix: 'Town', short: 'HEX', nickname: 'The Hexers', primary: '#8D99AE', secondary: '#2B2D42', pattern: 'stripes', badge: 'round', stadium: 'Foundry Lane', capacity: 12500, rep: 48, founded: 1899 },
  { town: 'Bridgend Vale', suffix: 'Athletic', short: 'BRV', nickname: 'The Valesmen', primary: '#C1121F', secondary: '#FDF0D5', pattern: 'halves', badge: 'shield', stadium: 'The Arches', capacity: 11000, rep: 46, founded: 1904 },
  { town: 'Duncastle', suffix: 'City', short: 'DUN', nickname: 'The Castle', primary: '#3A0CA3', secondary: '#F72585', pattern: 'solid', badge: 'crest', stadium: 'Keep Street', capacity: 10500, rep: 44, founded: 1911 },
  { town: 'Lowfield', suffix: 'Rovers', short: 'LOW', nickname: 'The Larks', primary: '#2A9D8F', secondary: '#264653', pattern: 'pinstripe', badge: 'round', stadium: 'Meadow End', capacity: 9000, rep: 42, founded: 1895 },
  { town: 'Cragside', suffix: 'Wanderers', short: 'CRA', nickname: 'The Climbers', primary: '#6A4C93', secondary: '#FFCA3A', pattern: 'hoops', badge: 'diamond', stadium: 'Quarry Ground', capacity: 8500, rep: 40, founded: 1908 },
  { town: 'Penhallow', suffix: 'FC', short: 'PEN', nickname: 'The Pilchards', primary: '#118AB2', secondary: '#FFFFFF', pattern: 'stripes', badge: 'shield', stadium: 'Harbour View', capacity: 7500, rep: 38, founded: 1913 },
  { town: 'Sedgebury', suffix: 'Town', short: 'SED', nickname: 'The Sedges', primary: '#606C38', secondary: '#FEFAE0', pattern: 'solid', badge: 'round', stadium: 'Fen Lane', capacity: 6500, rep: 35, founded: 1920 },
];
