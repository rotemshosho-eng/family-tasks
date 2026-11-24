// Stand-in for firebase-messaging.js in ?demo=1: no push notifications in the demo.
export const isSupported = async () => false;
export const getMessaging = () => ({});
export const getToken = async () => null;
export const deleteToken = async () => {};
export const onMessage = () => () => {};
