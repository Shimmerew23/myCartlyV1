const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const { ExtractJwt } = require('passport-jwt');
const crypto = require('crypto');
const { prisma } = require('./prisma');
const userService = require('../services/userService');
const logger = require('../utils/logger');

// JWT Strategy — for protected API routes that use passport
passport.use(
  'jwt',
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => req?.cookies?.accessToken || null,
      ]),
      secretOrKey: process.env.JWT_SECRET,
      passReqToCallback: true,
    },
    async (req, payload, done) => {
      try {
        const user = await prisma.user.findUnique({ where: { id: payload.id } });
        if (!user || !user.isActive) return done(null, false, { message: 'User not found or inactive' });
        return done(null, user);
      } catch (err) {
        return done(err, false);
      }
    }
  )
);

// Exported so it can be unit-tested without a live Google round-trip.
const googleVerify = async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await prisma.user.findFirst({ where: { googleId: profile.id } });

    if (!user) {
      const email = String(profile.emails[0].value).toLowerCase();
      user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        user = await prisma.user.update({ where: { id: user.id }, data: { googleId: profile.id } });
      } else {
        user = await prisma.user.create({
          data: {
            name: profile.displayName,
            email,
            avatar: profile.photos?.[0]?.value,
            googleId: profile.id,
            isEmailVerified: true,
            password: await userService.hashPassword(crypto.randomBytes(16).toString('hex')),
            preferences: userService.DEFAULT_PREFERENCES,
            featureFlags: userService.DEFAULT_FEATURE_FLAGS,
          },
        });
      }
    }

    return done(null, user);
  } catch (err) {
    logger.error(`Google OAuth error: ${err.message}`);
    return done(err, null);
  }
};

// Google OAuth Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    'google',
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      googleVerify
    )
  );
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id } });
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

module.exports = passport;
module.exports.googleVerify = googleVerify;
