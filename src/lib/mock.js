// Dev fallback data returned until the Intermedia credentials are configured.
// Mirrors the shapes the iOS app expects.
export const mock = {
  account: { id: 'usr-71499-01', displayName: 'Orlando Capote', extensionNumber: '101',
             email: 'orlando@capotesolutions.com', presence: 'available' },
  contacts: [
    { name: 'Maria Gomez', extensionNumber: '102', phone: '+1 305 555 0102', title: 'Ventas', presence: 'available', isFavorite: true },
    { name: 'James Carter', extensionNumber: '103', phone: '+1 305 555 0103', title: 'Soporte IT', presence: 'busy', isFavorite: true },
  ],
  calls: [
    { contactName: 'Maria Gomez', number: '102', direction: 'incoming', date: new Date().toISOString(), duration: 342 },
    { contactName: 'Cliente ACME', number: '+1 786 555 8890', direction: 'missed', date: new Date().toISOString(), duration: 0 },
  ],
  voicemails: [
    { contactName: 'Cliente ACME', number: '+1 786 555 8890', date: new Date().toISOString(), duration: 34,
      transcript: 'Hola, llamaba para confirmar la instalación de las cámaras…', isNew: true },
  ],
  conversations: [
    { contactName: 'Maria Gomez', presence: 'available',
      messages: [{ text: '¿Enviaste la cotización?', date: new Date().toISOString(), isMine: false }] },
  ],
  meetings: [
    { title: 'Revisión semanal de ventas', start: new Date(Date.now() + 3600e3).toISOString(),
      durationMinutes: 30, organizer: 'Maria Gomez', joinURL: 'https://meet.intermedia.com/capote-ventas' },
  ],
};
