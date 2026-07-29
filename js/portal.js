// ══════════════════════════════════════════════════════════════════════════
// CUSTOMER PORTAL (Phase 4)
// ══════════════════════════════════════════════════════════════════════════
// A read-only, white-labelled view a customer reaches via a magic link
// (#/portal/<token>). The customer is NOT a Supabase auth user — the signed
// token IS the credential. The portal shows that customer's jobs, their
// approved/sent (sealed) reports, and their quotes/invoices, all downloadable.
//
// Data sources:
//   • Real token → portal-data Edge Function (validates the HMAC token
//     server-side and returns the customer's data from the org store).
//   • local-<customerId> token → reads localStorage directly. This is the
//     trial/preview + verification path; it only works on the device that
//     holds the data (the inspector's own browser).
//
// The portal renders into a full-screen #vx-portal-root and never shows the
// app shell or login. It's intercepted at boot before normal app init.
// ══════════════════════════════════════════════════════════════════════════

var _vxPortalData = null;   // the fetched portal payload, kept for downloads

// ── Portal i18n (Portal v2 — deferred depth) ─────────────────────────────────
// The portal renders independently of the inspector app, so it has its OWN
// language, resolved from: the customer's explicit pick on this device →
// the admin's per-customer default (data.customer.lang) → the browser language
// → English. We keep portal strings co-located here (rather than the app's big
// i18n catalogue) so the whole customer-facing surface lives in one file.
var VX_PORTAL_LANGS = [
  { code: 'en',    label: 'English'    },
  { code: 'nl-NL', label: 'Nederlands' },
  { code: 'de-DE', label: 'Deutsch'    },
  { code: 'fr-FR', label: 'Français'   },
  { code: 'es-ES', label: 'Español'    },
];
var PORTAL_I18N = {
  'en': {
    'loading': 'Loading your portal…',
    'unavailable': 'Portal unavailable',
    'invalid_link': 'This link is invalid or has expired.',
    'customer_portal': 'Customer portal',
    'language': 'Language',
    'cockpit_title': 'Asset overview',
    'kpi_reports': 'Reports', 'kpi_reports_sub': 'issued',
    'kpi_acc_rate': 'Acceptable rate', 'kpi_acc_sub': '{n} with a verdict',
    'kpi_open': 'Open issues', 'kpi_open_sub': 'not acceptable',
    'kpi_active': 'Active jobs', 'kpi_ack_sub': '{n} acknowledged',
    'passrate_by_method': 'Pass rate by method', 'pass': 'pass', 'results_by_month': 'Results by month',
    'schedule_title': 'Inspection schedule', 'request_change': 'Request change',
    'upcoming': 'Upcoming', 'recent': 'Recent', 'until': 'until', 'exam': 'Exam',
    'your_requests': 'Your requests', 'date_change': 'Date change',
    'inspection_request': 'Inspection request', 'received': 'Received',
    'jobs_reports': 'Jobs & reports', 'no_jobs': 'No jobs to show yet.',
    'reports_one': '{n} report', 'reports_many': '{n} reports',
    'rev': 'Rev', 'no_reports_job': 'No issued reports for this job yet.',
    'acknowledge': 'Acknowledge', 'acknowledged': '✓ Acknowledged',
    'pdf': '⬇ PDF', 'pack': '⬇ Pack',
    'invoices': 'Invoices', 'quotes': 'Quotes',
    'accept': 'Accept', 'decline': 'Decline', 'accepted': '✓ Accepted',
    'pay_online': 'Pay online', 'overdue': 'Overdue', 'draft': 'Draft',
    'days_overdue_one': '{n} day overdue', 'days_overdue_many': '{n} days overdue',
    'due_in_one': 'due in {n} day', 'due_in_many': 'due in {n} days',
    'pay_note_can': 'Pay securely online with the button beside each unpaid invoice, or use',
    'pay_note_cannot': 'To pay an invoice, please use',
    'pay_note_tail': 'the bank details on the invoice PDF and quote the invoice number.',
    'search_ph': 'Search reports, jobs, invoices…',
    'request_inspection': '+ Request an inspection',
    'payment_received': '✓ Payment received — thank you. The invoice will show as paid shortly.',
    'sign_name': 'Your name (signature)', 'full_name': 'Full name',
    'note_optional': 'Note (optional)', 'note_ph': 'Anything to add…',
    'cancel': 'Cancel', 'confirm': 'Confirm', 'send_request': 'Send request',
    'ack_title': 'Acknowledge report {x}',
    'ack_body': 'Confirm you have received and reviewed this report. Your name and the time are recorded as a receipt.',
    'ack_note_ph': 'Comments on the findings (optional)…',
    'ack_recording': 'Recording acknowledgement…', 'ack_done': 'Thank you — acknowledgement recorded.',
    'quote_accept_title': 'Accept quote {x}', 'quote_decline_title': 'Decline quote {x}',
    'quote_accept_body': 'Confirm you accept this quotation. Your name and the time are recorded.',
    'quote_decline_body': 'Confirm you decline this quotation. Your name and the time are recorded.',
    'quote_recording': 'Recording your decision…',
    'quote_accepted_toast': 'Quote accepted — thank you.', 'quote_declined_toast': 'Quote declined — noted.',
    'decline_reason_ph': 'Reason (optional)…', 'any_note_ph': 'Any note (optional)…',
    'req_title': 'Request an inspection', 'req_sub': "Tell us what you need and we'll be in touch.",
    'req_what_ph': 'What needs inspecting? (e.g. Unit 4 weld survey)',
    'req_method': '— Method (optional) —', 'req_other': 'Other',
    'urgency_normal': 'Normal', 'urgency_high': 'High priority', 'urgency_urgent': 'Urgent',
    'req_site_ph': 'Site / location (optional)', 'req_scope_ph': 'Scope or details (optional)',
    'your_name': 'Your name', 'req_sending': 'Sending your request…',
    'req_sent': "Request sent — thank you. We'll be in touch.",
    'date_title': 'Request a date change', 'date_currently': 'currently',
    'date_pref': 'Preferred date & time', 'date_reason_ph': 'Reason (optional)',
    'date_sent': 'Date-change request sent — thank you.',
    'nothing_open': 'Nothing to open.', 'report_na': 'Report not available.',
    'doc_na': 'Document not available.', 'doc_not_found': 'Document not found.',
    'job_not_found': 'Job not found.', 'no_reports_pack': 'No issued reports to include yet.',
    'pay_need_live': 'Online payment needs a live portal link.',
    'pay_unavailable': 'Payments are not available right now.', 'pay_opening': 'Opening secure checkout…',
    'pay_no_checkout': 'Could not start checkout.',
    'submit_need_live': 'This action needs a live portal link.', 'submit_failed': 'Could not submit — please try again.',
    'signed_in_as': 'Signed in as', 'role_viewer': 'Viewer', 'role_approver': 'Approver', 'role_billing': 'Billing',
  },
  'nl-NL': {
    'loading': 'Uw portaal laden…',
    'unavailable': 'Portaal niet beschikbaar',
    'invalid_link': 'Deze link is ongeldig of verlopen.',
    'customer_portal': 'Klantportaal', 'language': 'Taal',
    'cockpit_title': 'Activa-overzicht',
    'kpi_reports': 'Rapporten', 'kpi_reports_sub': 'uitgegeven',
    'kpi_acc_rate': 'Goedkeuringspercentage', 'kpi_acc_sub': '{n} met een oordeel',
    'kpi_open': 'Openstaande punten', 'kpi_open_sub': 'niet aanvaardbaar',
    'kpi_active': 'Actieve opdrachten', 'kpi_ack_sub': '{n} bevestigd',
    'passrate_by_method': 'Slagingspercentage per methode', 'pass': 'goed', 'results_by_month': 'Resultaten per maand',
    'schedule_title': 'Inspectieplanning', 'request_change': 'Wijziging aanvragen',
    'upcoming': 'Binnenkort', 'recent': 'Recent', 'until': 'tot', 'exam': 'Onderzoek',
    'your_requests': 'Uw aanvragen', 'date_change': 'Datumwijziging',
    'inspection_request': 'Inspectieaanvraag', 'received': 'Ontvangen',
    'jobs_reports': 'Opdrachten & rapporten', 'no_jobs': 'Nog geen opdrachten.',
    'reports_one': '{n} rapport', 'reports_many': '{n} rapporten',
    'rev': 'Rev', 'no_reports_job': 'Nog geen rapporten voor deze opdracht.',
    'acknowledge': 'Bevestigen', 'acknowledged': '✓ Bevestigd',
    'pdf': '⬇ PDF', 'pack': '⬇ Bundel',
    'invoices': 'Facturen', 'quotes': 'Offertes',
    'accept': 'Accepteren', 'decline': 'Afwijzen', 'accepted': '✓ Geaccepteerd',
    'pay_online': 'Online betalen', 'overdue': 'Achterstallig', 'draft': 'Concept',
    'days_overdue_one': '{n} dag te laat', 'days_overdue_many': '{n} dagen te laat',
    'due_in_one': 'over {n} dag', 'due_in_many': 'over {n} dagen',
    'pay_note_can': 'Betaal veilig online met de knop naast elke openstaande factuur, of gebruik',
    'pay_note_cannot': 'Om een factuur te betalen, gebruik',
    'pay_note_tail': 'de bankgegevens op de factuur-pdf en vermeld het factuurnummer.',
    'search_ph': 'Zoek rapporten, opdrachten, facturen…',
    'request_inspection': '+ Inspectie aanvragen',
    'payment_received': '✓ Betaling ontvangen — bedankt. De factuur wordt binnenkort als betaald weergegeven.',
    'sign_name': 'Uw naam (handtekening)', 'full_name': 'Volledige naam',
    'note_optional': 'Opmerking (optioneel)', 'note_ph': 'Iets toe te voegen…',
    'cancel': 'Annuleren', 'confirm': 'Bevestigen', 'send_request': 'Aanvraag versturen',
    'ack_title': 'Rapport {x} bevestigen',
    'ack_body': 'Bevestig dat u dit rapport heeft ontvangen en beoordeeld. Uw naam en het tijdstip worden als ontvangstbewijs vastgelegd.',
    'ack_note_ph': 'Opmerkingen over de bevindingen (optioneel)…',
    'ack_recording': 'Bevestiging vastleggen…', 'ack_done': 'Bedankt — bevestiging vastgelegd.',
    'quote_accept_title': 'Offerte {x} accepteren', 'quote_decline_title': 'Offerte {x} afwijzen',
    'quote_accept_body': 'Bevestig dat u deze offerte accepteert. Uw naam en het tijdstip worden vastgelegd.',
    'quote_decline_body': 'Bevestig dat u deze offerte afwijst. Uw naam en het tijdstip worden vastgelegd.',
    'quote_recording': 'Uw beslissing vastleggen…',
    'quote_accepted_toast': 'Offerte geaccepteerd — bedankt.', 'quote_declined_toast': 'Offerte afgewezen — genoteerd.',
    'decline_reason_ph': 'Reden (optioneel)…', 'any_note_ph': 'Eventuele opmerking (optioneel)…',
    'req_title': 'Inspectie aanvragen', 'req_sub': 'Vertel ons wat u nodig heeft en wij nemen contact op.',
    'req_what_ph': 'Wat moet er geïnspecteerd worden? (bijv. lasonderzoek Unit 4)',
    'req_method': '— Methode (optioneel) —', 'req_other': 'Anders',
    'urgency_normal': 'Normaal', 'urgency_high': 'Hoge prioriteit', 'urgency_urgent': 'Urgent',
    'req_site_ph': 'Locatie (optioneel)', 'req_scope_ph': 'Omvang of details (optioneel)',
    'your_name': 'Uw naam', 'req_sending': 'Uw aanvraag versturen…',
    'req_sent': 'Aanvraag verstuurd — bedankt. Wij nemen contact op.',
    'date_title': 'Datumwijziging aanvragen', 'date_currently': 'nu',
    'date_pref': 'Voorkeursdatum & -tijd', 'date_reason_ph': 'Reden (optioneel)',
    'date_sent': 'Aanvraag datumwijziging verstuurd — bedankt.',
    'nothing_open': 'Niets om te openen.', 'report_na': 'Rapport niet beschikbaar.',
    'doc_na': 'Document niet beschikbaar.', 'doc_not_found': 'Document niet gevonden.',
    'job_not_found': 'Opdracht niet gevonden.', 'no_reports_pack': 'Nog geen rapporten om op te nemen.',
    'pay_need_live': 'Online betalen vereist een actieve portaallink.',
    'pay_unavailable': 'Betalingen zijn momenteel niet beschikbaar.', 'pay_opening': 'Beveiligde betaling openen…',
    'pay_no_checkout': 'Kon de betaling niet starten.',
    'submit_need_live': 'Deze actie vereist een actieve portaallink.', 'submit_failed': 'Verzenden mislukt — probeer het opnieuw.',
    'signed_in_as': 'Aangemeld als', 'role_viewer': 'Lezer', 'role_approver': 'Goedkeurder', 'role_billing': 'Facturatie',
  },
  'de-DE': {
    'loading': 'Ihr Portal wird geladen…',
    'unavailable': 'Portal nicht verfügbar',
    'invalid_link': 'Dieser Link ist ungültig oder abgelaufen.',
    'customer_portal': 'Kundenportal', 'language': 'Sprache',
    'cockpit_title': 'Anlagenübersicht',
    'kpi_reports': 'Berichte', 'kpi_reports_sub': 'ausgestellt',
    'kpi_acc_rate': 'Annahmequote', 'kpi_acc_sub': '{n} mit Bewertung',
    'kpi_open': 'Offene Punkte', 'kpi_open_sub': 'nicht akzeptabel',
    'kpi_active': 'Aktive Aufträge', 'kpi_ack_sub': '{n} bestätigt',
    'passrate_by_method': 'Bestehensquote nach Verfahren', 'pass': 'bestanden', 'results_by_month': 'Ergebnisse pro Monat',
    'schedule_title': 'Inspektionsplan', 'request_change': 'Änderung anfragen',
    'upcoming': 'Demnächst', 'recent': 'Kürzlich', 'until': 'bis', 'exam': 'Prüfung',
    'your_requests': 'Ihre Anfragen', 'date_change': 'Terminänderung',
    'inspection_request': 'Inspektionsanfrage', 'received': 'Erhalten',
    'jobs_reports': 'Aufträge & Berichte', 'no_jobs': 'Noch keine Aufträge.',
    'reports_one': '{n} Bericht', 'reports_many': '{n} Berichte',
    'rev': 'Rev', 'no_reports_job': 'Noch keine Berichte für diesen Auftrag.',
    'acknowledge': 'Bestätigen', 'acknowledged': '✓ Bestätigt',
    'pdf': '⬇ PDF', 'pack': '⬇ Paket',
    'invoices': 'Rechnungen', 'quotes': 'Angebote',
    'accept': 'Annehmen', 'decline': 'Ablehnen', 'accepted': '✓ Angenommen',
    'pay_online': 'Online bezahlen', 'overdue': 'Überfällig', 'draft': 'Entwurf',
    'days_overdue_one': '{n} Tag überfällig', 'days_overdue_many': '{n} Tage überfällig',
    'due_in_one': 'fällig in {n} Tag', 'due_in_many': 'fällig in {n} Tagen',
    'pay_note_can': 'Zahlen Sie sicher online über die Schaltfläche neben jeder offenen Rechnung, oder verwenden Sie',
    'pay_note_cannot': 'Um eine Rechnung zu bezahlen, verwenden Sie',
    'pay_note_tail': 'die Bankverbindung auf der Rechnungs-PDF und geben Sie die Rechnungsnummer an.',
    'search_ph': 'Berichte, Aufträge, Rechnungen suchen…',
    'request_inspection': '+ Inspektion anfragen',
    'payment_received': '✓ Zahlung erhalten — vielen Dank. Die Rechnung wird in Kürze als bezahlt angezeigt.',
    'sign_name': 'Ihr Name (Unterschrift)', 'full_name': 'Vollständiger Name',
    'note_optional': 'Notiz (optional)', 'note_ph': 'Etwas hinzuzufügen…',
    'cancel': 'Abbrechen', 'confirm': 'Bestätigen', 'send_request': 'Anfrage senden',
    'ack_title': 'Bericht {x} bestätigen',
    'ack_body': 'Bestätigen Sie, dass Sie diesen Bericht erhalten und geprüft haben. Ihr Name und die Uhrzeit werden als Empfangsbestätigung erfasst.',
    'ack_note_ph': 'Anmerkungen zu den Ergebnissen (optional)…',
    'ack_recording': 'Bestätigung wird erfasst…', 'ack_done': 'Danke — Bestätigung erfasst.',
    'quote_accept_title': 'Angebot {x} annehmen', 'quote_decline_title': 'Angebot {x} ablehnen',
    'quote_accept_body': 'Bestätigen Sie, dass Sie dieses Angebot annehmen. Ihr Name und die Uhrzeit werden erfasst.',
    'quote_decline_body': 'Bestätigen Sie, dass Sie dieses Angebot ablehnen. Ihr Name und die Uhrzeit werden erfasst.',
    'quote_recording': 'Ihre Entscheidung wird erfasst…',
    'quote_accepted_toast': 'Angebot angenommen — vielen Dank.', 'quote_declined_toast': 'Angebot abgelehnt — notiert.',
    'decline_reason_ph': 'Grund (optional)…', 'any_note_ph': 'Anmerkung (optional)…',
    'req_title': 'Inspektion anfragen', 'req_sub': 'Sagen Sie uns, was Sie benötigen, und wir melden uns.',
    'req_what_ph': 'Was soll geprüft werden? (z. B. Schweißnahtprüfung Einheit 4)',
    'req_method': '— Verfahren (optional) —', 'req_other': 'Andere',
    'urgency_normal': 'Normal', 'urgency_high': 'Hohe Priorität', 'urgency_urgent': 'Dringend',
    'req_site_ph': 'Standort (optional)', 'req_scope_ph': 'Umfang oder Details (optional)',
    'your_name': 'Ihr Name', 'req_sending': 'Ihre Anfrage wird gesendet…',
    'req_sent': 'Anfrage gesendet — vielen Dank. Wir melden uns.',
    'date_title': 'Terminänderung anfragen', 'date_currently': 'aktuell',
    'date_pref': 'Wunschdatum & -zeit', 'date_reason_ph': 'Grund (optional)',
    'date_sent': 'Anfrage zur Terminänderung gesendet — vielen Dank.',
    'nothing_open': 'Nichts zu öffnen.', 'report_na': 'Bericht nicht verfügbar.',
    'doc_na': 'Dokument nicht verfügbar.', 'doc_not_found': 'Dokument nicht gefunden.',
    'job_not_found': 'Auftrag nicht gefunden.', 'no_reports_pack': 'Noch keine Berichte zum Einbeziehen.',
    'pay_need_live': 'Für die Online-Zahlung ist ein aktiver Portallink erforderlich.',
    'pay_unavailable': 'Zahlungen sind derzeit nicht verfügbar.', 'pay_opening': 'Sichere Kasse wird geöffnet…',
    'pay_no_checkout': 'Kasse konnte nicht gestartet werden.',
    'submit_need_live': 'Diese Aktion erfordert einen aktiven Portallink.', 'submit_failed': 'Senden fehlgeschlagen — bitte erneut versuchen.',
    'signed_in_as': 'Angemeldet als', 'role_viewer': 'Betrachter', 'role_approver': 'Genehmiger', 'role_billing': 'Abrechnung',
  },
  'fr-FR': {
    'loading': 'Chargement de votre portail…',
    'unavailable': 'Portail indisponible',
    'invalid_link': 'Ce lien est invalide ou a expiré.',
    'customer_portal': 'Portail client', 'language': 'Langue',
    'cockpit_title': "Vue d'ensemble des actifs",
    'kpi_reports': 'Rapports', 'kpi_reports_sub': 'émis',
    'kpi_acc_rate': "Taux d'acceptation", 'kpi_acc_sub': '{n} avec un verdict',
    'kpi_open': 'Points ouverts', 'kpi_open_sub': 'non acceptable',
    'kpi_active': 'Missions actives', 'kpi_ack_sub': '{n} accusé(s) de réception',
    'passrate_by_method': 'Taux de réussite par méthode', 'pass': 'réussite', 'results_by_month': 'Résultats par mois',
    'schedule_title': "Planning d'inspection", 'request_change': 'Demander un changement',
    'upcoming': 'À venir', 'recent': 'Récent', 'until': "jusqu'au", 'exam': 'Examen',
    'your_requests': 'Vos demandes', 'date_change': 'Changement de date',
    'inspection_request': "Demande d'inspection", 'received': 'Reçue',
    'jobs_reports': 'Missions & rapports', 'no_jobs': 'Aucune mission pour le moment.',
    'reports_one': '{n} rapport', 'reports_many': '{n} rapports',
    'rev': 'Rév', 'no_reports_job': 'Aucun rapport émis pour cette mission.',
    'acknowledge': 'Accuser réception', 'acknowledged': '✓ Reçu',
    'pdf': '⬇ PDF', 'pack': '⬇ Dossier',
    'invoices': 'Factures', 'quotes': 'Devis',
    'accept': 'Accepter', 'decline': 'Refuser', 'accepted': '✓ Accepté',
    'pay_online': 'Payer en ligne', 'overdue': 'En retard', 'draft': 'Brouillon',
    'days_overdue_one': '{n} jour de retard', 'days_overdue_many': '{n} jours de retard',
    'due_in_one': 'dû dans {n} jour', 'due_in_many': 'dû dans {n} jours',
    'pay_note_can': 'Payez en ligne en toute sécurité avec le bouton à côté de chaque facture impayée, ou utilisez',
    'pay_note_cannot': 'Pour régler une facture, veuillez utiliser',
    'pay_note_tail': 'les coordonnées bancaires sur le PDF de la facture en indiquant le numéro de facture.',
    'search_ph': 'Rechercher rapports, missions, factures…',
    'request_inspection': '+ Demander une inspection',
    'payment_received': '✓ Paiement reçu — merci. La facture sera marquée comme payée sous peu.',
    'sign_name': 'Votre nom (signature)', 'full_name': 'Nom complet',
    'note_optional': 'Note (facultatif)', 'note_ph': 'Quelque chose à ajouter…',
    'cancel': 'Annuler', 'confirm': 'Confirmer', 'send_request': 'Envoyer la demande',
    'ack_title': 'Accuser réception du rapport {x}',
    'ack_body': 'Confirmez que vous avez reçu et examiné ce rapport. Votre nom et l\'heure sont enregistrés comme accusé de réception.',
    'ack_note_ph': 'Commentaires sur les conclusions (facultatif)…',
    'ack_recording': "Enregistrement de l'accusé de réception…", 'ack_done': 'Merci — accusé de réception enregistré.',
    'quote_accept_title': 'Accepter le devis {x}', 'quote_decline_title': 'Refuser le devis {x}',
    'quote_accept_body': 'Confirmez que vous acceptez ce devis. Votre nom et l\'heure sont enregistrés.',
    'quote_decline_body': 'Confirmez que vous refusez ce devis. Votre nom et l\'heure sont enregistrés.',
    'quote_recording': 'Enregistrement de votre décision…',
    'quote_accepted_toast': 'Devis accepté — merci.', 'quote_declined_toast': 'Devis refusé — noté.',
    'decline_reason_ph': 'Motif (facultatif)…', 'any_note_ph': 'Note (facultatif)…',
    'req_title': 'Demander une inspection', 'req_sub': 'Dites-nous ce dont vous avez besoin et nous vous recontacterons.',
    'req_what_ph': 'Que faut-il inspecter ? (p. ex. contrôle de soudure Unité 4)',
    'req_method': '— Méthode (facultatif) —', 'req_other': 'Autre',
    'urgency_normal': 'Normale', 'urgency_high': 'Priorité haute', 'urgency_urgent': 'Urgent',
    'req_site_ph': 'Site / lieu (facultatif)', 'req_scope_ph': 'Portée ou détails (facultatif)',
    'your_name': 'Votre nom', 'req_sending': 'Envoi de votre demande…',
    'req_sent': 'Demande envoyée — merci. Nous vous recontacterons.',
    'date_title': 'Demander un changement de date', 'date_currently': 'actuellement',
    'date_pref': 'Date et heure souhaitées', 'date_reason_ph': 'Motif (facultatif)',
    'date_sent': 'Demande de changement de date envoyée — merci.',
    'nothing_open': 'Rien à ouvrir.', 'report_na': 'Rapport non disponible.',
    'doc_na': 'Document non disponible.', 'doc_not_found': 'Document introuvable.',
    'job_not_found': 'Mission introuvable.', 'no_reports_pack': 'Aucun rapport émis à inclure pour le moment.',
    'pay_need_live': 'Le paiement en ligne nécessite un lien de portail actif.',
    'pay_unavailable': 'Les paiements ne sont pas disponibles pour le moment.', 'pay_opening': 'Ouverture du paiement sécurisé…',
    'pay_no_checkout': "Impossible de démarrer le paiement.",
    'submit_need_live': 'Cette action nécessite un lien de portail actif.', 'submit_failed': "Échec de l'envoi — veuillez réessayer.",
    'signed_in_as': 'Connecté en tant que', 'role_viewer': 'Lecteur', 'role_approver': 'Approbateur', 'role_billing': 'Facturation',
  },
  'es-ES': {
    'loading': 'Cargando su portal…',
    'unavailable': 'Portal no disponible',
    'invalid_link': 'Este enlace no es válido o ha caducado.',
    'customer_portal': 'Portal del cliente', 'language': 'Idioma',
    'cockpit_title': 'Resumen de activos',
    'kpi_reports': 'Informes', 'kpi_reports_sub': 'emitidos',
    'kpi_acc_rate': 'Tasa de aceptación', 'kpi_acc_sub': '{n} con veredicto',
    'kpi_open': 'Asuntos abiertos', 'kpi_open_sub': 'no aceptable',
    'kpi_active': 'Trabajos activos', 'kpi_ack_sub': '{n} confirmados',
    'passrate_by_method': 'Tasa de aprobación por método', 'pass': 'aprobado', 'results_by_month': 'Resultados por mes',
    'schedule_title': 'Calendario de inspección', 'request_change': 'Solicitar cambio',
    'upcoming': 'Próximas', 'recent': 'Recientes', 'until': 'hasta', 'exam': 'Examen',
    'your_requests': 'Sus solicitudes', 'date_change': 'Cambio de fecha',
    'inspection_request': 'Solicitud de inspección', 'received': 'Recibida',
    'jobs_reports': 'Trabajos e informes', 'no_jobs': 'Aún no hay trabajos.',
    'reports_one': '{n} informe', 'reports_many': '{n} informes',
    'rev': 'Rev', 'no_reports_job': 'Aún no hay informes para este trabajo.',
    'acknowledge': 'Confirmar', 'acknowledged': '✓ Confirmado',
    'pdf': '⬇ PDF', 'pack': '⬇ Paquete',
    'invoices': 'Facturas', 'quotes': 'Presupuestos',
    'accept': 'Aceptar', 'decline': 'Rechazar', 'accepted': '✓ Aceptado',
    'pay_online': 'Pagar en línea', 'overdue': 'Vencida', 'draft': 'Borrador',
    'days_overdue_one': '{n} día vencida', 'days_overdue_many': '{n} días vencida',
    'due_in_one': 'vence en {n} día', 'due_in_many': 'vence en {n} días',
    'pay_note_can': 'Pague de forma segura en línea con el botón junto a cada factura pendiente, o utilice',
    'pay_note_cannot': 'Para pagar una factura, utilice',
    'pay_note_tail': 'los datos bancarios del PDF de la factura e indique el número de factura.',
    'search_ph': 'Buscar informes, trabajos, facturas…',
    'request_inspection': '+ Solicitar una inspección',
    'payment_received': '✓ Pago recibido — gracias. La factura aparecerá como pagada en breve.',
    'sign_name': 'Su nombre (firma)', 'full_name': 'Nombre completo',
    'note_optional': 'Nota (opcional)', 'note_ph': 'Algo que añadir…',
    'cancel': 'Cancelar', 'confirm': 'Confirmar', 'send_request': 'Enviar solicitud',
    'ack_title': 'Confirmar informe {x}',
    'ack_body': 'Confirme que ha recibido y revisado este informe. Su nombre y la hora se registran como acuse de recibo.',
    'ack_note_ph': 'Comentarios sobre los resultados (opcional)…',
    'ack_recording': 'Registrando confirmación…', 'ack_done': 'Gracias — confirmación registrada.',
    'quote_accept_title': 'Aceptar presupuesto {x}', 'quote_decline_title': 'Rechazar presupuesto {x}',
    'quote_accept_body': 'Confirme que acepta este presupuesto. Su nombre y la hora se registran.',
    'quote_decline_body': 'Confirme que rechaza este presupuesto. Su nombre y la hora se registran.',
    'quote_recording': 'Registrando su decisión…',
    'quote_accepted_toast': 'Presupuesto aceptado — gracias.', 'quote_declined_toast': 'Presupuesto rechazado — anotado.',
    'decline_reason_ph': 'Motivo (opcional)…', 'any_note_ph': 'Nota (opcional)…',
    'req_title': 'Solicitar una inspección', 'req_sub': 'Díganos qué necesita y nos pondremos en contacto.',
    'req_what_ph': '¿Qué hay que inspeccionar? (p. ej. inspección de soldadura Unidad 4)',
    'req_method': '— Método (opcional) —', 'req_other': 'Otro',
    'urgency_normal': 'Normal', 'urgency_high': 'Prioridad alta', 'urgency_urgent': 'Urgente',
    'req_site_ph': 'Lugar / ubicación (opcional)', 'req_scope_ph': 'Alcance o detalles (opcional)',
    'your_name': 'Su nombre', 'req_sending': 'Enviando su solicitud…',
    'req_sent': 'Solicitud enviada — gracias. Nos pondremos en contacto.',
    'date_title': 'Solicitar cambio de fecha', 'date_currently': 'actualmente',
    'date_pref': 'Fecha y hora preferidas', 'date_reason_ph': 'Motivo (opcional)',
    'date_sent': 'Solicitud de cambio de fecha enviada — gracias.',
    'nothing_open': 'Nada que abrir.', 'report_na': 'Informe no disponible.',
    'doc_na': 'Documento no disponible.', 'doc_not_found': 'Documento no encontrado.',
    'job_not_found': 'Trabajo no encontrado.', 'no_reports_pack': 'Aún no hay informes emitidos para incluir.',
    'pay_need_live': 'El pago en línea requiere un enlace de portal activo.',
    'pay_unavailable': 'Los pagos no están disponibles en este momento.', 'pay_opening': 'Abriendo el pago seguro…',
    'pay_no_checkout': 'No se pudo iniciar el pago.',
    'submit_need_live': 'Esta acción requiere un enlace de portal activo.', 'submit_failed': 'No se pudo enviar — inténtelo de nuevo.',
    'signed_in_as': 'Conectado como', 'role_viewer': 'Lector', 'role_approver': 'Aprobador', 'role_billing': 'Facturación',
  },
};
var _vxPortalLangCache = null;
function _vxPortalResolveLang(){
  // 1) explicit customer choice on this device
  try { var s = localStorage.getItem('vx-portal-lang'); if(s && PORTAL_I18N[s]) return s; } catch(e){}
  // 2) admin per-customer default
  var def = _vxPortalData && _vxPortalData.customer && _vxPortalData.customer.lang;
  if(def && PORTAL_I18N[def]) return def;
  // 3) browser language → nearest available locale (exact, then 2-letter)
  try {
    var nav = String(navigator.language || 'en');
    if(PORTAL_I18N[nav]) return nav;
    var two = nav.slice(0, 2).toLowerCase();
    var hit = Object.keys(PORTAL_I18N).find(function(c){ return c.slice(0, 2).toLowerCase() === two; });
    if(hit) return hit;
  } catch(e){}
  return 'en';
}
function _vxPortalLang(){
  if(_vxPortalLangCache) return _vxPortalLangCache;
  _vxPortalLangCache = _vxPortalResolveLang();
  return _vxPortalLangCache;
}
function _vxPortalSetLang(code){
  if(!PORTAL_I18N[code]) return;
  _vxPortalLangCache = code;
  try { localStorage.setItem('vx-portal-lang', code); } catch(e){}
  try { document.documentElement.lang = code; } catch(e){}
  _vxPortalReRender();
}
// Portal translate. _ptl(key, englishFallback) → string in the portal language.
function _ptl(key, en){
  var d = PORTAL_I18N[_vxPortalLang()];
  if(d && d[key] != null) return d[key];
  var e = PORTAL_I18N['en'];
  if(e && e[key] != null) return e[key];
  return (en != null ? en : key);
}
// Plural + {n} interpolation: _ptn(3,'reports_one','reports_many') → "3 reports".
function _ptn(n, oneKey, manyKey){
  return _ptl(Math.abs(n) === 1 ? oneKey : manyKey).replace('{n}', n);
}
// Document / job status badge labels. English values pass through unchanged.
var PORTAL_STATUS_I18N = {
  'en': {},
  'nl-NL': { Draft:'Concept', Sent:'Verzonden', Paid:'Betaald', Overdue:'Achterstallig', Accepted:'Geaccepteerd', Declined:'Afgewezen', Pending:'In afwachting', Active:'Actief', Closed:'Afgesloten' },
  'de-DE': { Draft:'Entwurf', Sent:'Gesendet', Paid:'Bezahlt', Overdue:'Überfällig', Accepted:'Angenommen', Declined:'Abgelehnt', Pending:'Ausstehend', Active:'Aktiv', Closed:'Abgeschlossen' },
  'fr-FR': { Draft:'Brouillon', Sent:'Envoyé', Paid:'Payée', Overdue:'En retard', Accepted:'Accepté', Declined:'Refusé', Pending:'En attente', Active:'Active', Closed:'Clôturée' },
  'es-ES': { Draft:'Borrador', Sent:'Enviada', Paid:'Pagada', Overdue:'Vencida', Accepted:'Aceptado', Declined:'Rechazado', Pending:'Pendiente', Active:'Activo', Closed:'Cerrado' },
};
function _portalStatus(s){
  if(!s) return s;
  var m = PORTAL_STATUS_I18N[_vxPortalLang()];
  return (m && m[s]) || s;
}
// ── Multi-contact roles (Portal v2 — deferred depth) ─────────────────────────
// A per-contact link carries a role (viewer | approver | billing). A
// customer-wide link has no contact/role → full access (backward compatible).
//   viewer   — view + download only
//   approver — + acknowledge reports, quote decisions, work/date requests
//   billing  — + pay invoices online
function _vxPortalCaps(){
  var c = _vxPortalData && _vxPortalData.contact;
  var role = c && c.role;
  if(!role) return { contact: null, role: null, ack: true, quote: true, request: true, pay: true };
  var rw = (role === 'approver' || role === 'billing');
  return { contact: c, role: role, ack: rw, quote: rw, request: rw, pay: role === 'billing' };
}
function _vxPortalRoleLabel(role){
  return role === 'viewer' ? _ptl('role_viewer') : role === 'billing' ? _ptl('role_billing') : _ptl('role_approver');
}

function vxPortalActive(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  return h.indexOf('portal/') === 0;
}
function _vxPortalToken(){
  const h = (location.hash || '').replace(/^#\/?/, '');
  const m = h.match(/^portal\/(.+)$/);
  return m ? decodeURIComponent(m[1].split('?')[0]) : '';
}

// ── Fetch ─────────────────────────────────────────────────────────────────
async function vxPortalFetch(token){
  if(!token) return { error: 'Missing portal token.' };
  if(token.indexOf('local-') === 0){
    return _vxPortalLocalData(token.slice('local-'.length));
  }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(sb && sb.functions){
    try {
      const r = await sb.functions.invoke('portal-data', { body: { token } });
      if(r.error){
        let msg = r.error.message || 'Could not load the portal.';
        try { if(r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
        return { error: msg };
      }
      return r.data;
    } catch(e){ return { error: String(e.message || e) }; }
  }
  return { error: 'Portal backend not configured.' };
}

// Local/preview data — filters localStorage to one customer. Mirrors what
// the portal-data Edge Function returns server-side.
function _vxPortalLocalData(customerId){
  const company = (typeof ls === 'function') ? (ls(KEYS.company, {}) || {}) : {};
  const customers = ls(KEYS.customers, []) || [];
  const cust = customers.find(c => c.id === customerId);
  if(!cust) return { error: 'Customer not found in local data (preview link only works on the device that created it).' };
  const jobs = (ls(KEYS.jobs, []) || []).filter(j => j.customerId === customerId);
  const jobIds = new Set(jobs.map(j => j.id));
  const reports = (ls(KEYS.reports, []) || [])
    .filter(r => jobIds.has(r.jobId) && (getReportStage(r) === 'Approved' || getReportStage(r) === 'Sent'))
    .map(r => ({ reportNo:r.reportNo, method:r.method, revision:r.revision, createdAt:r.createdAt, verdict:r.verdict, jobId:r.jobId, stage:getReportStage(r), sealedHtml:r.sealedHtml || r.frozenHtml || '', acknowledgedBy:r.acknowledgedBy||'', acknowledgedAt:r.acknowledgedAt||'', examDate:r.examDate||'' }));
  const quotes = (ls(KEYS.quotes, []) || []).filter(q => q.customerId === customerId && (q.status === 'Sent' || q.status === 'Accepted'));
  const invoices = (ls(KEYS.invoices, []) || []).filter(i => i.customerId === customerId);
  // The customer's own submitted requests (from the local requests store).
  let requests = [];
  try {
    const key = (typeof VX_PORTAL_REQ_KEY !== 'undefined') ? VX_PORTAL_REQ_KEY : 'vx-portal-requests-v1';
    requests = (JSON.parse(localStorage.getItem(key) || '[]') || [])
      .filter(e => e && e.customerId === customerId && (e.kind === 'work-request' || e.kind === 'date-change'))
      .map(e => ({ id:e.id, kind:e.kind, at:e.at, title:e.title||'', method:e.method||'', urgency:e.urgency||'', site:e.site||'', scope:e.scope||'', requestedDate:e.requestedDate||'', requestedTime:e.requestedTime||'', reason:e.reason||'', jobTitle:e.jobTitle||'' }))
      .sort((a,b) => String(b.at||'').localeCompare(String(a.at||'')));
  } catch(e){}
  return {
    company: { name:company.name||'', logo:((company.logoUseOnPortal==='dark' && company.logoDark) ? company.logoDark : company.logo)||'', color:company.color||'#185FA5', footer:company.footer||'', portalSections:company.portalSections||{} },
    customer: { name:cust.name||'', id:cust.id, lang:cust.portalLang||'' },
    jobs, reports, quotes, invoices, requests,
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function vxPortalBoot(){
  // Portal mode: a customer, not an app user. Suppress the app shell, the
  // login screen, and the first-run welcome modal / trial banner.
  window._vxPortalMode = true;
  try { localStorage.setItem('vx-welcome-seen-v2', '1'); } catch(e){}
  try { const ls0 = document.getElementById('login-screen'); if(ls0) ls0.classList.add('hidden'); } catch(e){}
  try { document.querySelectorAll('.app, #app, .topbar, .topnav').forEach(e => { e.style.display = 'none'; }); } catch(e){}
  const _killChrome = () => {
    ['vx-welcome-modal','vx-trial-banner'].forEach(id => { const m = document.getElementById(id); if(m) m.remove(); });
  };
  _killChrome();
  setTimeout(_killChrome, 80); setTimeout(_killChrome, 350);
  let root = document.getElementById('vx-portal-root');
  if(!root){ root = document.createElement('div'); root.id = 'vx-portal-root'; document.body.appendChild(root); }
  root.style.cssText = 'position:fixed;inset:0;z-index:5000;overflow-y:auto;background:#eef0f4;color:#1c2333;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif';
  root.innerHTML = '<div style="max-width:760px;margin:80px auto;text-align:center;color:#6b7589">' + _portalEsc(_ptl('loading', 'Loading your portal…')) + '</div>';
  const data = await vxPortalFetch(_vxPortalToken());
  _vxPortalData = data;
  _vxPortalLangCache = null;   // re-resolve language now the customer default is known
  if(!data || data.error){ root.innerHTML = _portalShell('', _portalNotice(data && data.error ? data.error : 'This link is invalid or has expired.')); return; }
  vxPortalRender(root, data);
}

// ── Render ──────────────────────────────────────────────────────────────────
function _portalEsc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s); }
function _portalMoney(n, cur){ return (typeof billFmtMoney === 'function') ? billFmtMoney(n, cur) : ((Number(n)||0).toFixed(2)); }
function _portalDate(d){ return (d && typeof fmtDate === 'function') ? fmtDate(d) : (d || '—'); }

function _portalShell(accent, inner){
  return `<div style="max-width:900px;margin:0 auto;padding:0 18px 48px">${inner}</div>`;
}
function _portalNotice(msg){
  return `<div style="background:#fff;border-radius:14px;margin-top:80px;padding:40px;text-align:center;box-shadow:0 1px 3px rgba(20,30,60,.08)">
    <div style="font-size:34px;margin-bottom:8px">🔒</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:6px">${_portalEsc(_ptl('unavailable', 'Portal unavailable'))}</div>
    <div style="font-size:13px;color:#6b7589">${_portalEsc(msg)}</div>
  </div>`;
}
function _portalBadge(label, color){
  return `<span style="display:inline-block;font-size:10px;font-weight:600;background:${color}1a;color:${color};padding:2px 9px;border-radius:4px">${_portalEsc(label)}</span>`;
}
function _portalJobStatusColor(s){ return s==='Active'?'#16a34a':s==='Closed'?'#6b7589':'#d97706'; }
function _portalDocStatusColor(s){ return (s==='Paid'||s==='Accepted')?'#16a34a':s==='Sent'?'#2563eb':(s==='Overdue'||s==='Declined')?'#dc2626':'#6b7589'; }

// ── Asset cockpit (Portal v2, Pillar E) ──────────────────────────────────────
// A per-customer inspection-health overview computed from THIS customer's
// issued reports: headline KPIs, pass-rate by method, and a short trend. Turns
// the portal from a document list into an asset-integrity view. Read-only;
// renders nothing until there are reports.
function _portalCockpit(data, accent){
  const reports = (data && data.reports) || [];
  if(!reports.length) return '';
  let acc = 0, rej = 0, oth = 0;
  const byMethod = {}, byMonth = {};
  reports.forEach(r => {
    const v = r.verdict, m = r.method || '—';
    byMethod[m] = byMethod[m] || { total:0, acc:0, rej:0 };
    byMethod[m].total++;
    if(v === 'Acceptable'){ acc++; byMethod[m].acc++; }
    else if(v === 'Not acceptable'){ rej++; byMethod[m].rej++; }
    else oth++;
    if(r.createdAt){ const d = new Date(r.createdAt); if(!isNaN(d.getTime())){ const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); byMonth[k] = byMonth[k] || { acc:0, rej:0 }; if(v === 'Acceptable') byMonth[k].acc++; else if(v === 'Not acceptable') byMonth[k].rej++; } }
  });
  const decided = acc + rej;
  const passRate = decided ? Math.round(acc / decided * 100) : null;
  const prColor = passRate == null ? '#6b7589' : passRate >= 90 ? '#16a34a' : passRate >= 70 ? '#d97706' : '#dc2626';
  const activeJobs = ((data.jobs) || []).filter(j => j.status === 'Active').length;
  const ackCount = reports.filter(r => r.acknowledgedBy).length;

  const kpi = (label, value, sub, color) => `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:13px 16px;flex:1;min-width:120px">
    <div style="font-size:10px;color:#9aa5bd;text-transform:uppercase;letter-spacing:.05em">${_portalEsc(label)}</div>
    <div style="font-size:25px;font-weight:800;color:${color || '#0b1220'};line-height:1.1;margin-top:3px">${_portalEsc(value)}</div>
    ${sub ? `<div style="font-size:11px;color:#6b7589;margin-top:2px">${_portalEsc(sub)}</div>` : ''}
  </div>`;

  const kpis = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
    ${kpi(_ptl('kpi_reports'), String(reports.length), _ptl('kpi_reports_sub'), accent)}
    ${kpi(_ptl('kpi_acc_rate'), passRate == null ? '—' : passRate + '%', _ptl('kpi_acc_sub').replace('{n}', decided), prColor)}
    ${kpi(_ptl('kpi_open'), String(rej), _ptl('kpi_open_sub'), rej ? '#dc2626' : '#16a34a')}
    ${kpi(_ptl('kpi_active'), String(activeJobs), _ptl('kpi_ack_sub').replace('{n}', ackCount), '#0b1220')}
  </div>`;

  const methodRows = Object.keys(byMethod).sort().map(m => {
    const x = byMethod[m], dec = x.acc + x.rej, pr = dec ? Math.round(x.acc / dec * 100) : null;
    const c = pr == null ? '#9aa5bd' : pr >= 90 ? '#16a34a' : pr >= 70 ? '#d97706' : '#dc2626';
    return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0">
      <span style="font-family:monospace;font-weight:700;font-size:12px;width:40px;color:${accent}">${_portalEsc(m)}</span>
      <div style="flex:1;height:8px;background:#eef0f4;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pr == null ? 0 : pr}%;background:${c}"></div></div>
      <span style="font-size:11px;color:#6b7589;width:96px;text-align:right">${pr == null ? '—' : pr + '% ' + _ptl('pass')} · ${x.total}</span>
    </div>`;
  }).join('');

  const months = Object.keys(byMonth).sort().slice(-6);
  let trendHtml = '';
  if(months.length > 1){
    const maxM = Math.max(1, ...months.map(k => byMonth[k].acc + byMonth[k].rej));
    const bars = months.map(k => {
      const x = byMonth[k], tot = x.acc + x.rej, h = Math.round((tot / maxM) * 56), accH = tot ? Math.round((x.acc / tot) * h) : 0;
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:5px;flex:1">
        <div style="height:56px;display:flex;flex-direction:column;justify-content:flex-end;width:22px">
          <div style="height:${h - accH}px;background:#dc2626;border-radius:3px 3px 0 0"></div>
          <div style="height:${accH}px;background:#16a34a"></div>
        </div>
        <span style="font-size:9px;color:#9aa5bd;font-family:monospace">${_portalEsc(k.slice(2))}</span>
      </div>`;
    }).join('');
    trendHtml = `<div style="flex:1;min-width:200px"><div style="font-size:11px;font-weight:600;color:#6b7589;margin-bottom:8px">${_portalEsc(_ptl('results_by_month'))}</div>
      <div style="display:flex;align-items:flex-end;gap:8px;height:78px">${bars}</div></div>`;
  }

  return `<h2 style="font-size:15px;margin:0 0 10px;color:#0b1220">${_portalEsc(_ptl('cockpit_title'))}</h2>
    ${kpis}
    <div style="display:flex;gap:18px;flex-wrap:wrap;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:16px 18px;margin-bottom:22px">
      <div style="flex:1;min-width:240px"><div style="font-size:11px;font-weight:600;color:#6b7589;margin-bottom:6px">${_portalEsc(_ptl('passrate_by_method'))}</div>${methodRows}</div>
      ${trendHtml}
    </div>`;
}

// ── Inspection schedule (Portal v2 — calendar of job/exam dates) ──────────────
function _portalSchedule(data, accent){
  const items = [];
  (data.jobs || []).forEach(j => { if(j.startDate) items.push({ ymd:String(j.startDate).slice(0,10), endYmd:j.endDate?String(j.endDate).slice(0,10):'', time:j.startTime||'', title:j.title||'Job', sub:_portalStatus(j.status||''), jobId:j.id, type:'job' }); });
  (data.reports || []).forEach(r => { if(r.examDate) items.push({ ymd:String(r.examDate).slice(0,10), endYmd:'', time:'', title:((r.method||'')+' '+(r.reportNo||'')).trim(), sub:_ptl('exam'), type:'exam' }); });
  if(!items.length) return '';
  items.sort((a,b) => a.ymd.localeCompare(b.ymd));

  // Days that carry an inspection (job ranges expanded) → calendar dots.
  const marked = {};
  items.forEach(it => {
    marked[it.ymd] = true;
    if(it.endYmd && it.endYmd > it.ymd){ let d = new Date(it.ymd+'T00:00:00'); const end = new Date(it.endYmd+'T00:00:00'); let g=0; while(d<=end && g++<400){ marked[d.toISOString().slice(0,10)] = true; d.setDate(d.getDate()+1); } }
  });
  const todayYmd = new Date().toISOString().slice(0,10);
  const focusItem = items.find(it => (it.endYmd||it.ymd) >= todayYmd) || items[items.length-1];
  const focus = new Date(focusItem.ymd+'T00:00:00');
  const year = focus.getFullYear(), month = focus.getMonth();
  const startDow = (new Date(year, month, 1).getDay()+6)%7;   // Monday-first
  const dim = new Date(year, month+1, 0).getDate();
  let cells = '';
  for(let i=0;i<startDow;i++) cells += '<div></div>';
  for(let d=1; d<=dim; d++){
    const k = year+'-'+String(month+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const has = marked[k], isToday = k===todayYmd;
    cells += `<div style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;position:relative;font-size:12px;border-radius:6px;${has?`background:${accent}14;color:${accent};font-weight:700`:'color:#6b7589'}${isToday?(';box-shadow:inset 0 0 0 1.5px '+accent):''}">${d}${has?`<span style="position:absolute;bottom:3px;width:4px;height:4px;border-radius:50%;background:${accent}"></span>`:''}</div>`;
  }
  const _loc = _vxPortalLang();
  const _schedCaps = _vxPortalCaps();
  // Localized Monday-first weekday initials (Jan 1 2024 was a Monday).
  const _dowNames = [];
  for(let i = 0; i < 7; i++){ let s = new Date(Date.UTC(2024, 0, 1 + i)).toLocaleString(_loc, { weekday: 'short', timeZone: 'UTC' }); s = s.charAt(0).toUpperCase() + s.slice(1); _dowNames.push(s.slice(0, 2)); }
  const dowRow = _dowNames.map(x=>`<div style="font-size:10px;color:#9aa5bd;text-align:center;padding-bottom:4px">${_portalEsc(x)}</div>`).join('');
  const cal = `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:14px 16px;flex:0 0 270px">
    <div style="font-weight:700;font-size:13px;margin-bottom:8px">${focus.toLocaleString(_loc,{month:'long',year:'numeric'})}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${dowRow}${cells}</div></div>`;

  const upcoming = items.filter(it => (it.endYmd||it.ymd) >= todayYmd).slice(0,8);
  const agendaRows = (upcoming.length ? upcoming : items.slice(-4)).map(it => {
    const dt = new Date(it.ymd+'T00:00:00');
    const dchg = (it.type==='job' && it.jobId && _schedCaps.request) ? `<button data-action="vxPortalRequestDateChange" data-args="'${_portalEsc(it.jobId)}'" title="${_portalEsc(_ptl('request_change'))}" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:10px;padding:3px 8px;white-space:nowrap">${_portalEsc(_ptl('request_change'))}</button>` : '';
    return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid #eef0f4">
      <div style="text-align:center;flex:0 0 42px"><div style="font-size:18px;font-weight:800;color:${accent};line-height:1">${dt.getDate()}</div><div style="font-size:10px;color:#9aa5bd;text-transform:uppercase">${dt.toLocaleString(_loc,{month:'short'})}</div></div>
      <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${_portalEsc(it.title)}${it.time?` <span style="color:${accent};font-weight:700">${_portalEsc(it.time)}</span>`:''}</div><div style="font-size:11px;color:#6b7589">${_portalEsc(it.sub)}${it.endYmd&&it.endYmd!==it.ymd?(' · '+_ptl('until')+' '+_portalDate(it.endYmd)):''}</div></div>
      ${dchg}
    </div>`;
  }).join('');
  const agenda = `<div style="flex:1;min-width:220px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);padding:14px 16px"><div style="font-size:11px;font-weight:600;color:#6b7589;margin-bottom:4px">${_portalEsc(upcoming.length?_ptl('upcoming'):_ptl('recent'))}</div>${agendaRows}</div>`;

  return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">${_portalEsc(_ptl('schedule_title'))}</h2>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:22px">${cal}${agenda}</div>`;
}

// ── Your submitted requests (Portal v2) ───────────────────────────────────────
function _portalRequests(data){
  const reqs = (data.requests || []);
  if(!reqs.length) return '';
  const rows = reqs.map(r => {
    const isDate = r.kind === 'date-change';
    const title = isDate
      ? (_ptl('date_change') + (r.jobTitle ? ' · ' + r.jobTitle : '') + (r.requestedDate ? ' → ' + _portalDate(r.requestedDate) + (r.requestedTime ? ' ' + r.requestedTime : '') : ''))
      : (r.title || _ptl('inspection_request'));
    const meta = (isDate ? [r.reason] : [r.method, r.site]).filter(Boolean).map(_portalEsc).join(' · ');
    return `<tr>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:13px;font-weight:600">${_portalEsc(title)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${meta}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589;white-space:nowrap">${_portalDate(r.at)}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right">${_portalBadge(_ptl('received'), '#6b7589')}</td>
    </tr>`;
  }).join('');
  return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">${_portalEsc(_ptl('your_requests'))}</h2>
    <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);overflow:hidden"><table style="width:100%;border-collapse:collapse">${rows}</table></div>`;
}

function vxPortalRender(root, data){
  const accent = (data.company && /^#[0-9A-Fa-f]{6}$/.test(data.company.color || '')) ? data.company.color : '#185FA5';
  const co = data.company || {};
  // Online payment is only available from a live (server-signed) portal link —
  // the local preview link has no token the payment function can verify.
  const _tok = _vxPortalToken();
  const caps = _vxPortalCaps();
  const canPay = !!_tok && _tok.indexOf('local-') !== 0 && caps.pay;
  // Stripe redirects back with ?paid=<invoiceId> after a successful checkout.
  const paidParam = (location.hash.split('?')[1] || '').match(/(?:^|&)paid=([^&]+)/);
  const paidNotice = paidParam
    ? `<div style="background:#dcfce7;border:1px solid #86efac;color:#15803d;border-radius:12px;padding:14px 18px;margin-bottom:16px;font-size:13px;font-weight:600">${_portalEsc(_ptl('payment_received'))}</div>`
    : '';
  const reportsByJob = {};
  (data.reports || []).forEach(r => { (reportsByJob[r.jobId] = reportsByJob[r.jobId] || []).push(r); });
  // F: free-text filter across reports / jobs / documents.
  const _q = (_vxPortalQuery || '').trim().toLowerCase();
  const _match = (s) => !_q || String(s == null ? '' : s).toLowerCase().indexOf(_q) !== -1;
  const _repMatch = (r) => _match(r.reportNo) || _match(r.method) || _match(r.subject);

  // Language switcher (Portal v2 — deferred depth). Customer can pick their
  // language; the choice is remembered on their device. Uses the delegated
  // change handler (data-on-change + data-pass-value).
  const langSel = `<select data-on-change="_vxPortalSetLang" data-pass-value="1" aria-label="${_portalEsc(_ptl('language'))}" title="${_portalEsc(_ptl('language'))}" style="font-size:12px;border:1px solid #d6dbe6;border-radius:7px;padding:5px 26px 5px 9px;background:#fff;color:#1c2333;cursor:pointer">${VX_PORTAL_LANGS.map(l => `<option value="${l.code}"${l.code === _vxPortalLang() ? ' selected' : ''}>${_portalEsc(l.label)}</option>`).join('')}</select>`;

  // Header (white-label)
  const header = `<div style="background:#fff;border-radius:0 0 16px 16px;box-shadow:0 1px 3px rgba(20,30,60,.08);padding:22px 26px;margin-bottom:22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    ${co.logo ? `<img src="${_portalEsc(co.logo)}" alt="" style="max-height:48px;max-width:180px;object-fit:contain"/>` : `<div style="font-size:20px;font-weight:800;color:${accent}">${_portalEsc(co.name || _ptl('customer_portal'))}</div>`}
    <div style="flex:1;min-width:20px"></div>
    ${langSel}
    <div style="text-align:right">
      <div style="font-size:11px;color:#9aa5bd;text-transform:uppercase;letter-spacing:.06em">${_portalEsc(_ptl('customer_portal'))}</div>
      <div style="font-size:14px;font-weight:600">${_portalEsc((data.customer && data.customer.name) || '')}</div>
      ${caps.contact ? `<div style="font-size:11px;color:#6b7589;margin-top:1px">${_portalEsc(_ptl('signed_in_as'))} ${_portalEsc(caps.contact.name || caps.contact.email || '')} · ${_portalEsc(_vxPortalRoleLabel(caps.role))}</div>` : ''}
    </div>
  </div>`;

  // Jobs + their reports
  let jobsHtml = `<h2 style="font-size:15px;margin:0 0 10px;color:#0b1220">${_portalEsc(_ptl('jobs_reports'))}</h2>`;
  if(!(data.jobs || []).length){
    jobsHtml += `<div style="background:#fff;border-radius:12px;padding:22px;color:#9aa5bd;font-size:13px;text-align:center">${_portalEsc(_ptl('no_jobs'))}</div>`;
  } else {
    jobsHtml += (data.jobs || []).map(j => {
      const allReps = reportsByJob[j.id] || [];
      let reps = allReps;
      if(_q){ const jt = _match(j.title); reps = allReps.filter(_repMatch); if(!jt && !reps.length) return ''; }
      const repRows = reps.length ? reps.map(r => `<tr>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-family:monospace;font-size:12px;color:${accent}">${_portalEsc(r.reportNo||'—')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:12px">${_portalEsc(r.method||'')} · ${_portalEsc(_ptl('rev'))} ${_portalEsc(r.revision||'00')}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${_portalDate(r.createdAt)}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;white-space:nowrap">${r.acknowledgedBy ? `<span title="${_portalDate(r.acknowledgedAt)} · ${_portalEsc(r.acknowledgedBy)}" style="font-size:11px;color:#16a34a;font-weight:600;margin-right:8px">${_portalEsc(_ptl('acknowledged'))}</span>` : (caps.ack ? `<button data-action="vxPortalAckReport" data-args="'${_portalEsc(r.reportNo)}','${_portalEsc(r.revision||'')}'" title="${_portalEsc(_ptl('acknowledge'))}" style="cursor:pointer;border:1px solid #16a34a;color:#16a34a;background:transparent;border-radius:6px;font-size:11px;padding:4px 10px;margin-right:6px">${_portalEsc(_ptl('acknowledge'))}</button>` : '')}${r.sealedHtml ? `<button data-action="vxPortalOpenReport" data-args="'${_portalEsc(r.reportNo)}'" title="${_portalEsc(_ptl('pdf'))}" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px">${_portalEsc(_ptl('pdf'))}</button>` : '<span style="font-size:11px;color:#9aa5bd">—</span>'}</td>
        </tr>`).join('') : `<tr><td colspan="4" style="padding:10px 8px;color:#9aa5bd;font-size:12px">${_portalEsc(_ptl('no_reports_job'))}</td></tr>`;
      return `<div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);margin-bottom:12px;overflow:hidden">
        <div style="padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #eef0f4">
          <span style="font-weight:700;font-size:14px">${_portalEsc(j.title||'—')}</span>
          ${_portalBadge(_portalStatus(j.status||'Pending'), _portalJobStatusColor(j.status))}
          <span style="flex:1"></span>
          <span style="font-size:11px;color:#9aa5bd">${_ptn(reps.length, 'reports_one', 'reports_many')}</span>
          ${allReps.some(r => r.sealedHtml) ? `<button data-action="vxPortalDownloadPack" data-args="'${_portalEsc(j.id)}'" title="${_portalEsc(_ptl('pack'))}" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px;margin-left:8px">${_portalEsc(_ptl('pack'))}</button>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse">${repRows}</table>
      </div>`;
    }).join('');
  }

  // Quotes + invoices
  const docBlock = (title, docs, type) => {
    if(!docs || !docs.length) return '';
    const rows = docs.map(d => {
      const total = (typeof billCalc === 'function') ? billCalc(d).total : 0;
      const overdue = (type==='invoice' && typeof billIsOverdue === 'function' && billIsOverdue(d));
      const status = overdue ? 'Overdue' : (d.status || 'Draft');
      // F: invoice aging — days until/over due, beside the status.
      let aging = '';
      if(type==='invoice' && d.status!=='Paid' && d.dueDate){
        const due = new Date(d.dueDate);
        if(!isNaN(due.getTime())){
          const days = Math.ceil((due.getTime() - Date.now()) / 86400000);
          aging = days < 0 ? `<div style="font-size:10px;color:#dc2626;margin-top:2px">${_portalEsc(_ptn(-days, 'days_overdue_one', 'days_overdue_many'))}</div>`
                : days <= 7 ? `<div style="font-size:10px;color:#d97706;margin-top:2px">${_portalEsc(_ptn(days, 'due_in_one', 'due_in_many'))}</div>` : '';
        }
      }
      return `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-family:monospace;font-size:12px;font-weight:600">${_portalEsc(d.number||'—')}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;font-size:11px;color:#6b7589">${_portalDate(d.issueDate)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4">${_portalBadge(_portalStatus(status), _portalDocStatusColor(status))}${aging}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;font-family:monospace;font-size:12px">${_portalMoney(total, d.currency)}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #eef0f4;text-align:right;white-space:nowrap">${(type==='quote' && d.status==='Sent' && caps.quote) ? `<button data-action="vxPortalQuoteDecision" data-args="'${_portalEsc(d.id)}','Accepted'" style="cursor:pointer;border:none;color:#fff;background:#16a34a;border-radius:6px;font-size:11px;padding:4px 11px;margin-right:6px;font-weight:600">${_portalEsc(_ptl('accept'))}</button><button data-action="vxPortalQuoteDecision" data-args="'${_portalEsc(d.id)}','Declined'" style="cursor:pointer;border:1px solid #dc2626;color:#dc2626;background:transparent;border-radius:6px;font-size:11px;padding:4px 10px;margin-right:6px">${_portalEsc(_ptl('decline'))}</button>` : ''}${(type==='quote' && d.status==='Accepted') ? `<span style="font-size:11px;color:#16a34a;font-weight:600;margin-right:8px">${_portalEsc(_ptl('accepted'))}${d.decisionBy ? ' · ' + _portalEsc(d.decisionBy) : ''}</span>` : ''}${(type==='invoice' && canPay && d.status!=='Paid') ? `<button data-action="vxPortalPayInvoice" data-args="'${_portalEsc(d.id)}'" style="cursor:pointer;border:none;color:#fff;background:#16a34a;border-radius:6px;font-size:11px;padding:4px 11px;margin-right:6px;font-weight:600">${_portalEsc(_ptl('pay_online'))}</button>` : ''}<button data-action="vxPortalOpenDoc" data-args="'${type}','${_portalEsc(d.id)}'" title="${_portalEsc(_ptl('pdf'))}" style="cursor:pointer;border:1px solid ${accent};color:${accent};background:transparent;border-radius:6px;font-size:11px;padding:4px 10px">${_portalEsc(_ptl('pdf'))}</button></td>
      </tr>`;
    }).join('');
    return `<h2 style="font-size:15px;margin:24px 0 10px;color:#0b1220">${_portalEsc(title)}</h2>
      <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(20,30,60,.06);overflow:hidden"><table style="width:100%;border-collapse:collapse">${rows}</table></div>`;
  };
  const invoicesHtml = docBlock(_ptl('invoices'), (data.invoices || []).filter(d => !_q || _match(d.number)), 'invoice');
  const quotesHtml   = docBlock(_ptl('quotes'), (data.quotes || []).filter(d => !_q || _match(d.number)), 'quote');

  const payNote = (data.invoices && data.invoices.some(i => i.status !== 'Paid'))
    ? `<div style="font-size:11px;color:#6b7589;margin-top:8px">${_portalEsc((canPay ? _ptl('pay_note_can') : _ptl('pay_note_cannot')) + ' ' + _ptl('pay_note_tail'))}</div>` : '';

  const footer = `<div style="text-align:center;color:#9aa5bd;font-size:11px;margin-top:30px">${_portalEsc(co.footer || co.name || '')}</div>`;

  // Section visibility — admin-controlled (Settings → Customer portal). Default
  // on when unset, so existing portals are unchanged.
  const _sec = (data.company && data.company.portalSections) || {};
  const _secOn = (k) => _sec[k] !== false;
  const cockpitHtml = _secOn('cockpit') ? _portalCockpit(data, accent) : '';
  const scheduleHtml = _secOn('schedule') ? _portalSchedule(data, accent) : '';
  const requestsHtml = _portalRequests(data);
  const requestCta = `<div style="display:flex;justify-content:flex-end;margin:-6px 0 16px"><button data-action="vxPortalRequestWork" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:9px;font-size:13px;font-weight:600;padding:10px 18px;box-shadow:0 1px 3px rgba(20,30,60,.12)">${_portalEsc(_ptl('request_inspection'))}</button></div>`;
  const searchBar = (data.jobs || []).length
    ? `<div style="margin:0 0 16px"><input id="vxp-search" type="search" value="${_portalEsc(_vxPortalQuery)}" data-on-input="vxPortalSearch" data-pass-value="1" placeholder="${_portalEsc(_ptl('search_ph'))}" style="width:100%;box-sizing:border-box;padding:11px 15px;border:1px solid #d6dbe6;border-radius:10px;font-size:14px;background:#fff;color:#1c2333"></div>`
    : '';
  root.innerHTML = header + _portalShell(accent, paidNotice
    + (_secOn('requestButton') && caps.request ? requestCta : '')
    + cockpitHtml + scheduleHtml + searchBar
    + (_secOn('reports') ? jobsHtml : '')
    + requestsHtml
    + (_secOn('invoices') ? invoicesHtml + payNote : '')
    + (_secOn('quotes') ? quotesHtml : '')
    + footer);
}

// ── Downloads ────────────────────────────────────────────────────────────────
function _vxPortalOpenHtml(html){
  if(!html){ if(typeof toast === 'function') toast(_ptl('nothing_open'), 'error'); return; }
  const w = window.open('', '_blank');
  if(!w){ if(typeof toast === 'function') toast('Pop-up blocked — allow pop-ups to open the document.', 'error'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
// Shared download options — pass the live portal token so the customer call to
// pdf-render authenticates (empty for the on-device preview link).
function _vxPortalDlOpts(){ const tok = _vxPortalToken(); return { portalToken: (tok && tok.indexOf('local-') !== 0) ? tok : '' }; }

function vxPortalOpenReport(reportNo){
  const r = (_vxPortalData && _vxPortalData.reports || []).find(x => x.reportNo === reportNo);
  if(!r || !r.sealedHtml){ if(typeof toast === 'function') toast(_ptl('report_na'), 'error'); return; }
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(r.sealedHtml, (reportNo || 'report'), _vxPortalDlOpts());
  else _vxPortalOpenHtml(r.sealedHtml);
}
function vxPortalOpenDoc(type, id){
  const list = (_vxPortalData && (type === 'invoice' ? _vxPortalData.invoices : _vxPortalData.quotes)) || [];
  const doc = list.find(d => d.id === id);
  if(!doc){ if(typeof toast === 'function') toast(_ptl('doc_not_found'), 'error'); return; }
  // Render via the billing doc-builder, passing the portal's company so it
  // works even though localStorage has no company on the customer's device.
  const html = (typeof billBuildDocHtml === 'function')
    ? billBuildDocHtml(type, doc, (_vxPortalData && _vxPortalData.company) || null)
    : '';
  if(!html){ if(typeof toast === 'function') toast(_ptl('doc_na'), 'error'); return; }
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(html, (doc.number || type), _vxPortalDlOpts());
  else _vxPortalOpenHtml(html);
}

// ── Self-serve depth (Portal v2, Pillar F) ───────────────────────────────────
// Download a consolidated report pack for one job — reuses the inspector-side
// builder, branded from the server-supplied company (the customer device has no
// local company profile).
function vxPortalDownloadPack(jobId){
  const data = _vxPortalData; if(!data) return;
  const job = (data.jobs || []).find(j => j.id === jobId);
  if(!job){ if(typeof toast === 'function') toast(_ptl('job_not_found'), 'error'); return; }
  const reps = (data.reports || []).filter(r => r.jobId === jobId && r.sealedHtml);
  if(!reps.length){ if(typeof toast === 'function') toast(_ptl('no_reports_pack'), 'warn'); return; }
  reps.sort((a, b) => (a.method || '').localeCompare(b.method || '') || String(a.reportNo || '').localeCompare(String(b.reportNo || '')));
  if(typeof vxBuildReportPackHtml !== 'function'){ if(typeof toast === 'function') toast('Pack export unavailable.', 'error'); return; }
  const cust = { name: (data.customer && data.customer.name) || '' };
  const html = vxBuildReportPackHtml(job, cust, reps, data.company || null);
  const fn = (job.title || 'job') + ' report pack';
  const tok = _vxPortalToken();
  // True no-dialog download → server-side vector PDF (passing the portal token
  // to authenticate), falling back to raster / print dialog.
  if(typeof vxDownloadHtmlAsPdf === 'function') vxDownloadHtmlAsPdf(html, fn, { portalToken: (tok && tok.indexOf('local-') !== 0) ? tok : '' });
  else if(typeof _vxPrintHtml === 'function') _vxPrintHtml(html);
  else _vxPortalOpenHtml(html);
}

// Portal search — filters jobs/reports/documents by a free-text query, then
// re-renders. Focus + caret are restored so typing isn't interrupted.
var _vxPortalQuery = '';
function vxPortalSearch(v){
  _vxPortalQuery = v || '';
  const root = document.getElementById('vx-portal-root');
  if(root && _vxPortalData && !_vxPortalData.error){
    const caret = (function(){ const e = document.getElementById('vxp-search'); return e ? e.selectionStart : null; })();
    vxPortalRender(root, _vxPortalData);
    const e = document.getElementById('vxp-search');
    if(e){ e.focus(); try { if(caret != null) e.setSelectionRange(caret, caret); } catch(_){} }
  }
}

// Pay an invoice online — asks the stripe-checkout Edge Function for a hosted
// Stripe Checkout URL (the portal token is the credential), then redirects the
// customer there. stripe-webhook flips the invoice to Paid on success.
async function vxPortalPayInvoice(id){
  const token = _vxPortalToken();
  if(!token || token.indexOf('local-') === 0){ if(typeof toast === 'function') toast(_ptl('pay_need_live'), 'warn'); return; }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.functions){ if(typeof toast === 'function') toast(_ptl('pay_unavailable'), 'error'); return; }
  if(typeof toast === 'function') toast(_ptl('pay_opening'), 'info');
  try {
    const r = await sb.functions.invoke('stripe-checkout', { body: { token, invoiceId: id } });
    if(r.error || !r.data || !r.data.url){
      let msg = _ptl('pay_no_checkout');
      try { if(r.error && r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
      if(typeof toast === 'function') toast(msg, 'error');
      return;
    }
    location.href = r.data.url;   // Stripe-hosted checkout page
  } catch(e){ if(typeof toast === 'function') toast(String(e.message || e), 'error'); }
}

// ── Two-way channel (Portal v2, Pillar A) ────────────────────────────────────
// Every customer action goes through one helper. A real (server-signed) token
// posts to the portal-submit Edge Function, which records a write-once event
// the inspector's app ingests. A local-<id> preview token has no cloud, so we
// apply the event straight to localStorage on-device — the same browser holds
// the data, so the loop still demonstrates end-to-end.
async function vxPortalSubmit(kind, payload){
  const token = _vxPortalToken();
  if(token && token.indexOf('local-') === 0){
    try { _vxApplyPortalEventLocal({ kind: kind, customerId: token.slice('local-'.length), at: new Date().toISOString(), by: (payload && payload.by) || '', ...payload }); return { ok:true, local:true }; }
    catch(e){ return { error: String(e.message || e) }; }
  }
  const sb = (typeof _vxSupabase === 'function') ? _vxSupabase() : null;
  if(!sb || !sb.functions) return { error: _ptl('submit_need_live') };
  try {
    const r = await sb.functions.invoke('portal-submit', { body: { token: token, kind: kind, payload: payload } });
    if(r.error){
      let msg = _ptl('submit_failed');
      try { if(r.error.context && typeof r.error.context.json === 'function'){ const j = await r.error.context.json(); if(j && j.error) msg = j.error; } } catch(_){}
      return { error: msg };
    }
    return r.data || { ok:true };
  } catch(e){ return { error: String(e.message || e) }; }
}

// Apply a customer event to the local store (preview path + the model the app's
// cloud-pull ingest reuses): a quote decision flips the quote; a report ack
// stamps the report. Mutations go through lss() so entity-key storage is safe.
function _vxApplyPortalEventLocal(ev){
  if(!ev || !ev.kind) return;
  if(ev.kind === 'quote-decision'){
    const quotes = ls(KEYS.quotes, []) || [];
    const q = quotes.find(x => x && x.id === ev.quoteId);
    if(q && q.status === 'Sent'){
      q.status = ev.decision;
      q[ev.decision === 'Accepted' ? 'acceptedAt' : 'declinedAt'] = ev.at;
      q.decisionBy = ev.by || '';
      lss(KEYS.quotes, quotes);
    }
  } else if(ev.kind === 'ack-report'){
    const reports = ls(KEYS.reports, []) || [];
    const r = reports.find(x => x && String(x.reportNo) === String(ev.reportNo) && (!ev.revision || String(x.revision) === String(ev.revision)));
    if(r){
      r.acknowledgedBy = ev.by || '';
      r.acknowledgedAt = ev.at;
      if(ev.note) r.acknowledgedNote = ev.note;
      if(typeof addReportAudit === 'function') try { addReportAudit(r, 'ack', 'Acknowledged by customer' + (ev.by ? ' (' + ev.by + ')' : '')); } catch(_){}
      lss(KEYS.reports, reports);
    }
  } else if(ev.kind === 'work-request' || ev.kind === 'date-change'){
    // Preview path mirrors the cloud ingest: file the request locally so the
    // inspector's Jobs page shows it on this device.
    try {
      const key = (typeof VX_PORTAL_REQ_KEY !== 'undefined') ? VX_PORTAL_REQ_KEY : 'vx-portal-requests-v1';
      const reqs = JSON.parse(localStorage.getItem(key) || '[]');
      reqs.unshift(Object.assign({ id: 'req-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6) }, ev));
      localStorage.setItem(key, JSON.stringify(reqs.slice(0, 200)));
    } catch(_){}
  }
}

// ── A tiny self-contained e-sign prompt (portal has no app modal helpers) ─────
// Resolves { by, note } or null. The typed name + server timestamp + IP that
// portal-submit records together form the click-wrap signature.
function _vxPortalPrompt(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(12,18,32,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    const accent = opts.accent || '#185FA5';
    ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px 22px 18px;box-shadow:0 12px 40px rgba(12,18,32,.3);font-family:inherit">
      <div style="font-size:16px;font-weight:700;margin-bottom:4px;color:#0b1220">${_portalEsc(opts.title || 'Confirm')}</div>
      <div style="font-size:12.5px;color:#6b7589;line-height:1.5;margin-bottom:14px">${_portalEsc(opts.body || '')}</div>
      <label style="font-size:11px;font-weight:600;color:#6b7589;text-transform:uppercase;letter-spacing:.04em">${_portalEsc(_ptl('sign_name'))}</label>
      <input id="vxpp-name" type="text" placeholder="${_portalEsc(_ptl('full_name'))}" value="${_portalEsc((_vxPortalData && _vxPortalData.contact && _vxPortalData.contact.name) || '')}" style="width:100%;box-sizing:border-box;margin:5px 0 12px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:14px;font-family:inherit">
      ${opts.note === false ? '' : `<label style="font-size:11px;font-weight:600;color:#6b7589;text-transform:uppercase;letter-spacing:.04em">${_portalEsc(_ptl('note_optional'))}</label>
      <textarea id="vxpp-note" rows="2" placeholder="${_portalEsc(opts.notePlaceholder || _ptl('note_ph'))}" style="width:100%;box-sizing:border-box;margin:5px 0 14px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:13px;font-family:inherit;resize:vertical"></textarea>`}
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="vxpp-cancel" style="cursor:pointer;border:1px solid #d6dbe6;background:#fff;color:#6b7589;border-radius:8px;font-size:13px;padding:8px 16px">${_portalEsc(_ptl('cancel'))}</button>
        <button id="vxpp-ok" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:8px;font-size:13px;font-weight:600;padding:8px 18px">${_portalEsc(opts.okLabel || _ptl('confirm'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { try { ov.remove(); } catch(_){} resolve(v); };
    const nameEl = ov.querySelector('#vxpp-name');
    ov.querySelector('#vxpp-cancel').addEventListener('click', () => done(null));
    ov.addEventListener('click', (e) => { if(e.target === ov) done(null); });
    ov.querySelector('#vxpp-ok').addEventListener('click', () => {
      const by = (nameEl.value || '').trim();
      if(!by){ nameEl.style.borderColor = '#dc2626'; nameEl.focus(); return; }
      const noteEl = ov.querySelector('#vxpp-note');
      done({ by: by, note: noteEl ? (noteEl.value || '').trim() : '' });
    });
    setTimeout(() => { try { nameEl.focus(); } catch(_){} }, 30);
  });
}

// Acknowledge receipt of an issued report (C — e-sign).
async function vxPortalAckReport(reportNo, revision){
  const accent = (_vxPortalData && _vxPortalData.company && _vxPortalData.company.color) || '#185FA5';
  const sig = await _vxPortalPrompt({ accent: accent, title: _ptl('ack_title').replace('{x}', reportNo), body: _ptl('ack_body'), okLabel: _ptl('acknowledge'), notePlaceholder: _ptl('ack_note_ph') });
  if(!sig) return;
  if(typeof toast === 'function') toast(_ptl('ack_recording'), 'info');
  const res = await vxPortalSubmit('ack-report', { reportNo: reportNo, revision: revision, by: sig.by, note: sig.note });
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  // Optimistically reflect it so the customer sees the receipt immediately.
  const r = (_vxPortalData && _vxPortalData.reports || []).find(x => String(x.reportNo) === String(reportNo));
  if(r){ r.acknowledgedBy = sig.by; r.acknowledgedAt = (res.at || new Date().toISOString()); if(sig.note) r.acknowledgedNote = sig.note; }
  if(typeof toast === 'function') toast(_ptl('ack_done'), 'success');
  _vxPortalReRender();
}

// Accept or decline a quote (C — e-sign).
async function vxPortalQuoteDecision(quoteId, decision){
  const accent = (_vxPortalData && _vxPortalData.company && _vxPortalData.company.color) || '#185FA5';
  const q = (_vxPortalData && _vxPortalData.quotes || []).find(x => x.id === quoteId);
  const num = q ? (q.number || '') : '';
  const sig = await _vxPortalPrompt({ accent: accent, title: (decision === 'Accepted' ? _ptl('quote_accept_title') : _ptl('quote_decline_title')).replace('{x}', num), body: (decision === 'Accepted' ? _ptl('quote_accept_body') : _ptl('quote_decline_body')), okLabel: (decision === 'Accepted' ? _ptl('accept') : _ptl('decline')), notePlaceholder: decision === 'Declined' ? _ptl('decline_reason_ph') : _ptl('any_note_ph') });
  if(!sig) return;
  if(typeof toast === 'function') toast(_ptl('quote_recording'), 'info');
  const res = await vxPortalSubmit('quote-decision', { quoteId: quoteId, decision: decision, by: sig.by, note: sig.note });
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  if(q){ q.status = decision; q.decisionBy = sig.by; }
  if(typeof toast === 'function') toast(decision === 'Accepted' ? _ptl('quote_accepted_toast') : _ptl('quote_declined_toast'), 'success');
  _vxPortalReRender();
}

// ── Work request (Portal v2, Pillar B) ───────────────────────────────────────
// A self-contained form letting the customer raise an inspection request, which
// the channel records as a work-request event the inspector's app files.
function _vxPortalRequestForm(accent){
  return new Promise((resolve) => {
    const methods = (typeof NDT_METHODS !== 'undefined' && Array.isArray(NDT_METHODS)) ? NDT_METHODS : [];
    const methodOpts = `<option value="">${_portalEsc(_ptl('req_method'))}</option>`
      + methods.map(m => `<option value="${_portalEsc(m.id)}">${_portalEsc(m.id + (m.name ? ' · ' + m.name : ''))}</option>`).join('')
      + `<option value="Other">${_portalEsc(_ptl('req_other'))}</option>`;
    const inp = 'width:100%;box-sizing:border-box;margin:0 0 10px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:13.5px;font-family:inherit';
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(12,18,32,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 18px;overflow-y:auto';
    ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:480px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(12,18,32,.3);font-family:inherit">
      <div style="font-size:16px;font-weight:700;margin-bottom:3px;color:#0b1220">${_portalEsc(_ptl('req_title'))}</div>
      <div style="font-size:12.5px;color:#6b7589;margin-bottom:14px">${_portalEsc(_ptl('req_sub'))}</div>
      <input id="vxr-title" placeholder="${_portalEsc(_ptl('req_what_ph'))}" style="${inp}">
      <div style="display:flex;gap:10px">
        <select id="vxr-method" style="${inp};flex:1">${methodOpts}</select>
        <select id="vxr-urgency" style="${inp};flex:1"><option value="Normal">${_portalEsc(_ptl('urgency_normal'))}</option><option value="High">${_portalEsc(_ptl('urgency_high'))}</option><option value="Urgent">${_portalEsc(_ptl('urgency_urgent'))}</option></select>
      </div>
      <input id="vxr-site" placeholder="${_portalEsc(_ptl('req_site_ph'))}" style="${inp}">
      <textarea id="vxr-scope" rows="3" placeholder="${_portalEsc(_ptl('req_scope_ph'))}" style="${inp};resize:vertical"></textarea>
      <input id="vxr-by" placeholder="${_portalEsc(_ptl('your_name'))}" value="${_portalEsc((_vxPortalData && _vxPortalData.contact && _vxPortalData.contact.name) || '')}" style="${inp}">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button id="vxr-cancel" style="cursor:pointer;border:1px solid #d6dbe6;background:#fff;color:#6b7589;border-radius:8px;font-size:13px;padding:8px 16px">${_portalEsc(_ptl('cancel'))}</button>
        <button id="vxr-ok" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:8px;font-size:13px;font-weight:600;padding:8px 18px">${_portalEsc(_ptl('send_request'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { try { ov.remove(); } catch(_){} resolve(v); };
    const titleEl = ov.querySelector('#vxr-title'), byEl = ov.querySelector('#vxr-by');
    ov.querySelector('#vxr-cancel').addEventListener('click', () => done(null));
    ov.addEventListener('click', (e) => { if(e.target === ov) done(null); });
    ov.querySelector('#vxr-ok').addEventListener('click', () => {
      const title = (titleEl.value || '').trim();
      if(!title){ titleEl.style.borderColor = '#dc2626'; titleEl.focus(); return; }
      const by = (byEl.value || '').trim();
      if(!by){ byEl.style.borderColor = '#dc2626'; byEl.focus(); return; }
      done({ title: title, method: ov.querySelector('#vxr-method').value, urgency: ov.querySelector('#vxr-urgency').value, site: (ov.querySelector('#vxr-site').value || '').trim(), scope: (ov.querySelector('#vxr-scope').value || '').trim(), by: by });
    });
    setTimeout(() => { try { titleEl.focus(); } catch(_){} }, 30);
  });
}
async function vxPortalRequestWork(){
  const accent = (_vxPortalData && _vxPortalData.company && _vxPortalData.company.color) || '#185FA5';
  const req = await _vxPortalRequestForm(accent);
  if(!req) return;
  if(typeof toast === 'function') toast(_ptl('req_sending'), 'info');
  const res = await vxPortalSubmit('work-request', req);
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  if(typeof toast === 'function') toast(_ptl('req_sent'), 'success');
}

// Request a different date for a scheduled job.
function _vxPortalDateForm(accent, job){
  return new Promise((resolve) => {
    const inp = 'width:100%;box-sizing:border-box;margin:0 0 10px;padding:9px 11px;border:1px solid #d6dbe6;border-radius:8px;font-size:13.5px;font-family:inherit';
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:6000;background:rgba(12,18,32,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 18px;overflow-y:auto';
    ov.innerHTML = `<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;box-shadow:0 12px 40px rgba(12,18,32,.3);font-family:inherit">
      <div style="font-size:16px;font-weight:700;margin-bottom:3px;color:#0b1220">${_portalEsc(_ptl('date_title'))}</div>
      <div style="font-size:12.5px;color:#6b7589;margin-bottom:14px">${_portalEsc(job ? (job.title || '') : '')}${job && job.startDate ? ' · ' + _ptl('date_currently') + ' ' + _portalDate(job.startDate) : ''}</div>
      <label style="font-size:11px;font-weight:600;color:#6b7589;text-transform:uppercase;letter-spacing:.04em">${_portalEsc(_ptl('date_pref'))}</label>
      <div style="display:flex;gap:10px;margin-top:5px">
        <input id="vxd-date" type="date" style="${inp};flex:1;margin:0 0 10px">
        <input id="vxd-time" type="time" style="${inp};flex:0 0 130px;margin:0 0 10px">
      </div>
      <textarea id="vxd-reason" rows="2" placeholder="${_portalEsc(_ptl('date_reason_ph'))}" style="${inp};resize:vertical"></textarea>
      <input id="vxd-by" placeholder="${_portalEsc(_ptl('your_name'))}" value="${_portalEsc((_vxPortalData && _vxPortalData.contact && _vxPortalData.contact.name) || '')}" style="${inp}">
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button id="vxd-cancel" style="cursor:pointer;border:1px solid #d6dbe6;background:#fff;color:#6b7589;border-radius:8px;font-size:13px;padding:8px 16px">${_portalEsc(_ptl('cancel'))}</button>
        <button id="vxd-ok" style="cursor:pointer;border:none;background:${accent};color:#fff;border-radius:8px;font-size:13px;font-weight:600;padding:8px 18px">${_portalEsc(_ptl('send_request'))}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const done = (v) => { try { ov.remove(); } catch(_){} resolve(v); };
    const dateEl = ov.querySelector('#vxd-date'), byEl = ov.querySelector('#vxd-by');
    ov.querySelector('#vxd-cancel').addEventListener('click', () => done(null));
    ov.addEventListener('click', (e) => { if(e.target === ov) done(null); });
    ov.querySelector('#vxd-ok').addEventListener('click', () => {
      if(!dateEl.value){ dateEl.style.borderColor = '#dc2626'; dateEl.focus(); return; }
      const by = (byEl.value || '').trim();
      if(!by){ byEl.style.borderColor = '#dc2626'; byEl.focus(); return; }
      done({ requestedDate: dateEl.value, requestedTime: (ov.querySelector('#vxd-time').value || ''), reason: (ov.querySelector('#vxd-reason').value || '').trim(), by: by });
    });
    setTimeout(() => { try { dateEl.focus(); } catch(_){} }, 30);
  });
}
async function vxPortalRequestDateChange(jobId){
  const data = _vxPortalData; if(!data) return;
  const job = (data.jobs || []).find(j => j.id === jobId) || null;
  const accent = (data.company && data.company.color) || '#185FA5';
  const r = await _vxPortalDateForm(accent, job);
  if(!r) return;
  if(typeof toast === 'function') toast(_ptl('req_sending'), 'info');
  const res = await vxPortalSubmit('date-change', { jobId: jobId, jobTitle: job ? job.title : '', requestedDate: r.requestedDate, requestedTime: r.requestedTime, reason: r.reason, by: r.by });
  if(res.error){ if(typeof toast === 'function') toast(res.error, 'error'); return; }
  if(typeof toast === 'function') toast(_ptl('date_sent'), 'success');
  _vxPortalReRender();
}

// Re-render the portal from the (possibly optimistically updated) data.
function _vxPortalReRender(){
  const root = document.getElementById('vx-portal-root');
  if(root && _vxPortalData && !_vxPortalData.error) vxPortalRender(root, _vxPortalData);
}

// Entering a portal link after the app already loaded — render the portal.
window.addEventListener('hashchange', function(){
  try { if(vxPortalActive() && !document.getElementById('vx-portal-root')) vxPortalBoot(); } catch(e){}
});

// Build a shareable portal link for a customer (used by the "Generate portal
// link" admin action). Real signed links come from the portal-token Edge
// Function; this builds the local preview link for trial/verification.
function vxPortalLocalLink(customerId){
  const base = location.origin + location.pathname;
  return base + '#/portal/local-' + customerId;
}

// ── Dispatch registration — see vxActions in js/constants.js.
// Object shorthand keeps each data-action name tied to its function, so a
// rename that misses one is a no-undef error rather than a dead control.
vxActions({
  _vxPortalSetLang, vxPortalAckReport, vxPortalDownloadPack,
  vxPortalOpenDoc, vxPortalOpenReport, vxPortalPayInvoice,
  vxPortalQuoteDecision, vxPortalRequestDateChange, vxPortalRequestWork,
  vxPortalSearch,
});
