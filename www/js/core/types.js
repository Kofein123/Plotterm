// Общие типы ядра. Все размеры в миллиметрах.
// «Бумажные» координаты: u вправо, v вниз от левого верхнего угла листа.
export const SPEED_PROFILES = {
    turbo: { name: 'Турбо', feed: 9000, hint: 'гелевая ручка, проверить тестом' },
    draft: { name: 'Черновик', feed: 6000, hint: 'быстрые заметки' },
    normal: { name: 'Обычный', feed: 4000, hint: 'конспект' },
    neat: { name: 'Аккуратный', feed: 2500, hint: 'чистовик, сдача' },
};
export function feedOf(s) {
    return s.profile === 'custom' ? s.customFeed : SPEED_PROFILES[s.profile].feed;
}
