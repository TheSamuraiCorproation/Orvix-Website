/* Newsletter sign-up: every <form data-subscribe> posts to /api/subscribe
   (netlify/functions/blog.mjs), which adds the address to the Brevo list.
   Messages follow the page language. */
(function () {
  var ar = (document.documentElement.lang || "").indexOf("ar") === 0;
  var T = ar ? {
    sending: "جارٍ الاشتراك…",
    done: "تم اشتراكك. سنراسلك عند نشر شيء جديد.",
    confirm: "بقيت خطوة واحدة: افتح بريدك واضغط الرابط لتأكيد اشتراكك.",
    confirmed: "تم التأكيد. أنت الآن على القائمة.",
    bad: "يرجى إدخال بريد إلكتروني صحيح.",
    fail: "تعذّرت إضافتك الآن. يرجى المحاولة لاحقاً."
  } : {
    sending: "Subscribing…",
    done: "You're subscribed. We'll email you when something new is published.",
    confirm: "One more step: check your inbox and click the link to confirm.",
    confirmed: "Confirmed. You're on the list.",
    bad: "Please enter a valid email address.",
    fail: "We couldn't add you right now. Please try again later."
  };

  function say(form, text, kind) {
    var m = form.querySelector(".sub-msg");
    if (!m) return;
    m.textContent = text;
    m.setAttribute("data-kind", kind || "");
  }

  function field(form, name) {
    var el = form.elements[name];
    return el ? el.value : "";
  }

  var forms = document.querySelectorAll("form[data-subscribe]");
  Array.prototype.forEach.call(forms, function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (form.getAttribute("data-busy")) return;
      var input = form.elements.email;
      var email = input.value.trim();
      if (!email || !input.checkValidity()) {
        say(form, T.bad, "err");
        input.focus();
        return;
      }
      var btn = form.querySelector("[type=submit]");
      form.setAttribute("data-busy", "1");
      if (btn) btn.disabled = true;
      say(form, T.sending, "");
      fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Orvix-Form": "1" },
        body: JSON.stringify({
          email: email,
          lang: ar ? "ar" : "en",
          sector: field(form, "sector"),
          company: field(form, "company")
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.ok && d.ok) {
            form.reset();
            say(form, d.confirm ? T.confirm : T.done, "ok");
          } else {
            say(form, r.status === 400 ? T.bad : T.fail, "err");
          }
        });
      }).catch(function () {
        say(form, T.fail, "err");
      }).then(function () {
        form.removeAttribute("data-busy");
        if (btn) btn.disabled = false;
      });
    });
  });

  // back from the confirmation email (double opt-in)
  if (/[?&]confirmed=1(&|$)/.test(location.search) && forms.length) say(forms[0], T.confirmed, "ok");
})();
