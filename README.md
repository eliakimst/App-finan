# Custos Pessoais

App web (PWA) para celular que reproduz a planilha **CUSTOS - PESSOAIS**: controle diário de saldo, cartões de crédito com fatura e uma calculadora de investimentos.

## Como a planilha calcula (e o app também)

| Coluna da planilha | No app | Efeito no saldo |
|---|---|---|
| SALDO (1ª coluna) | Entrada | soma no dia |
| SAÍDAS | Saída | subtrai no dia |
| SAÍDAS em verde claro | Investimento | subtrai no dia e entra no total investido |
| C6 / LATAM | Cartão | não mexe no saldo do dia: vira fatura |
| SALDO (última coluna) | Saldo do dia | saldo anterior + entradas − saídas − faturas |

Fatura: as compras de um mês (fechamento padrão = último dia) são debitadas no vencimento do mês seguinte (C6 dia 10, LATAM dia 1). Fechamento e vencimento podem ser ajustados por cartão.

## Usar

Abra `index.html` servido por HTTP (por exemplo, GitHub Pages) e use "Adicionar à tela inicial" no celular. Os dados ficam salvos só no aparelho (localStorage); use **Ajustes → Exportar** para fazer backup.
