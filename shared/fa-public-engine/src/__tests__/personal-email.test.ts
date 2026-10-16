import { emailDomain, isLikelyPersonalEmail } from '../engine/personalEmail';

describe('personal e-mail detector (advisory: a warning, never a blocker)', () => {
  it.each([
    'ana@gmail.com', 'ANA@GMAIL.COM', 'a@googlemail.com', 'a@outlook.com', 'a@outlook.es', 'a@hotmail.com', 'a@hotmail.com.mx', 'a@hotmail.es', 'a@live.com', 'a@live.com.mx', 'a@msn.com',
    'a@yahoo.com', 'a@yahoo.com.mx', 'a@yahoo.es', 'a@ymail.com', 'a@icloud.com', 'a@me.com', 'a@aol.com', 'a@proton.me', 'a@protonmail.com', 'a@gmx.de', 'a@gmx.net', 'a@mail.com', 'a@terra.com.mx', ' ana@gmail.com ',
  ])('%s looks personal', (e) => expect(isLikelyPersonalEmail(e)).toBe(true));
  it.each([
    'lucia@nortica.example', 'ana@beeside.you', 'x@empresa.com.mx', 'x@mail.empresa.com', 'x@gmail.company.com', 'x@mygmail.com', 'x@outlook.empresa.mx', 'x@hotmail.empresa.com', 'x@universidad.edu', 'nobody', 'x@', '@gmail.com', 'x@localhost',
  ])('%s is treated as corporate (no warning)', (e) => expect(isLikelyPersonalEmail(e)).toBe(false));
  it('extracts the domain case-insensitively', () => { expect(emailDomain(' Ana@Gmail.COM ')).toBe('gmail.com'); expect(emailDomain('nope')).toBe(''); });
});
