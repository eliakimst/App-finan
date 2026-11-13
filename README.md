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

Cartões (compras não mexem no saldo do dia; a fatura é debitada no vencimento):

| Cartão | Ciclo de compras | Vencimento |
|---|---|---|
| LATAM | dia 1 ao último dia do mês | dia 1 do mês seguinte |
| CAIXA | dia 28 do mês anterior ao dia 27 | dia 8 do mês seguinte |
| C6 | dia 1 ao último dia do mês | dia 10 do mês seguinte |

## Sobra para aplicar

As contas do início do mês (dia 1 em diante) são pagas com o saldo do mês anterior. A **sobra** é o saldo no dia anterior aos recebimentos (padrão: dia 4, recebimentos a partir do dia 5) e é o valor disponível para aplicar. O dia é configurável em Ajustes.

Ao registrar um lançamento, o app mostra antes de salvar quando ele sai do saldo, como fica a sobra afetada e se o saldo fica negativo nos próximos 12 meses.

## Usar

Abra `index.html` servido por HTTP (por exemplo, GitHub Pages) e use "Adicionar à tela inicial" no celular. Os dados ficam salvos só no aparelho (localStorage); use **Ajustes → Exportar** para fazer backup.
